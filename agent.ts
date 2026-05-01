import {
  Agent,
  Cursor,
  type AgentMessage,
  type AgentOptions,
  type RunResult,
  type Run,
  type SDKAgent,
  type SDKAgentInfo,
  type SDKMessage,
  type SDKModel,
} from "@cursor/sdk";
import { setMaxListeners } from "node:events";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

setMaxListeners(100);

const ROOT = dirname(fileURLToPath(import.meta.url));
const SKILL_ROOT = resolve(ROOT, ".agents/skills/obsidian-visuals");
const DEFAULT_MODEL = "composer-2";
const DEFAULT_MODEL_ENV = "CURSOR_DEFAULT_MODEL";

type ColorName = "cyan" | "green" | "yellow" | "red" | "gray" | "bold" | "dim";

const ANSI: Record<ColorName | "reset", string> = {
  reset: "\x1b[0m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
};

type Options = {
  targetNote?: string;
  vaultPath?: string;
  model: string;
  modelsCache?: SDKModel[];
  checkOnly: boolean;
  verbose: boolean;
  plain: boolean;
  force: boolean;
  noSandbox: boolean;
  agentId?: string;
};

type CommandResult = "continue" | "exit" | "refresh-preamble";

type Session = {
  agent: SDKAgent;
  needsPreamble: boolean;
  lastAgents: SDKAgentInfo[];
  lastRuns: Run[];
};

function paint(options: Options, color: ColorName, text: string): string {
  if (!useColor(options)) return text;
  return `${ANSI[color]}${text}${ANSI.reset}`;
}

function useColor(options: Options): boolean {
  return !options.plain && Boolean(output.isTTY) && !process.env.NO_COLOR;
}

function label(options: Options, text: string): string {
  return paint(options, "gray", text);
}

function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;

  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    process.env[key] = parseEnvValue(rawValue);
  }
}

function parseEnvValue(rawValue: string): string {
  const value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    targetNote: process.env.OBSIDIAN_VISUALS_TARGET_NOTE
      ? resolve(process.env.OBSIDIAN_VISUALS_TARGET_NOTE)
      : undefined,
    vaultPath: process.env.OBSIDIAN_VAULT_PATH
      ? resolve(process.env.OBSIDIAN_VAULT_PATH)
      : undefined,
    model: process.env[DEFAULT_MODEL_ENV] ?? DEFAULT_MODEL,
    checkOnly: false,
    verbose: false,
    plain: false,
    force: false,
    noSandbox: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    switch (arg) {
      case "--":
        break;
      case "--target":
        options.targetNote = resolve(next());
        break;
      case "--vault":
        options.vaultPath = resolve(next());
        break;
      case "--model":
        options.model = next();
        break;
      case "--agent-id":
        options.agentId = next();
        break;
      case "--check":
        options.checkOnly = true;
        break;
      case "--verbose":
        options.verbose = true;
        break;
      case "--plain":
        options.plain = true;
        break;
      case "--force":
        options.force = true;
        break;
      case "--no-sandbox":
        options.noSandbox = true;
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`Usage: pnpm run agent -- [options]

Options:
  --target <path>      Optional default Obsidian note for the assistant context.
  --vault <path>       Obsidian vault root. Also configurable with OBSIDIAN_VAULT_PATH.
  --model <id>         Cursor model id. Overrides environment defaults.
  --agent-id <id>      Reuse a specific local Cursor agent id.
  --force              Expire a stuck active local run before each send.
  --no-sandbox         Disable Cursor SDK local sandboxing for the agent.
  --verbose            Print thinking/status/tool detail.
  --plain              Disable ANSI colors and terminal polish.
  --check              Validate local configuration without creating an agent.
  --help               Show this help.

Environment:
  CURSOR_API_KEY       Required to create the Cursor SDK agent.
  LUMA_API_KEY         Required only when the approved conversation calls Luma.
  OBSIDIAN_VAULT_PATH  Optional default vault root.
  ${DEFAULT_MODEL_ENV}  Optional default model override.
`);
}

function checkConfiguration(options: Options): boolean {
  const checks = [
    ["repo root", ROOT, existsSync(ROOT)],
    ["agent skill", resolve(SKILL_ROOT, "SKILL.md"), existsSync(resolve(SKILL_ROOT, "SKILL.md"))],
    [
      "vault",
      options.vaultPath ?? "not configured",
      options.vaultPath ? existsSync(options.vaultPath) : true,
    ],
    [
      "target note",
      options.targetNote ?? "not configured",
      options.targetNote ? existsSync(options.targetNote) : true,
    ],
    ["CURSOR_API_KEY", "environment or .env", Boolean(process.env.CURSOR_API_KEY)],
    ["LUMA_API_KEY", "environment or .env", Boolean(process.env.LUMA_API_KEY)],
  ] satisfies Array<[string, string, boolean]>;

  let ok = true;
  for (const [name, value, present] of checks) {
    const status = present ? "ok" : "missing";
    console.log(`${status.padEnd(7)} ${name}: ${value}`);
    ok = ok && present;
  }
  console.log(`model   ${options.model}`);
  return ok;
}

function printHeader(options: Options): void {
  const title = paint(options, "bold", "Obsidian Visuals");
  const subtitle = paint(options, "gray", "Cursor SDK assistant");
  const divider = paint(options, "gray", "─".repeat(56));

  console.log(`${title} ${subtitle}`);
  console.log(divider);
  console.log(`${label(options, "model")} ${options.model}`);
  console.log(`${label(options, "agent")} ${options.agentId ?? paint(options, "gray", "new")}`);
  console.log(`${label(options, "vault")} ${options.vaultPath ?? paint(options, "gray", "none")}`);
  console.log(`${label(options, "note ")} ${options.targetNote ?? paint(options, "gray", "none")}`);
  console.log(
    `${label(options, "mode ")} ${options.verbose ? "verbose" : "quiet"}${options.plain ? ", plain" : ""}`,
  );
  console.log(divider);
  console.log(
    `${paint(options, "gray", "Type a request to begin. /help for commands. /exit to quit.")}\n`,
  );
}

function printStatus(options: Options): void {
  console.log(paint(options, "bold", "Session"));
  console.log(`${label(options, "agent  ")} ${options.agentId ?? "none"}`);
  console.log(`${label(options, "model  ")} ${options.model}`);
  console.log(`${label(options, "vault  ")} ${options.vaultPath ?? "none"}`);
  console.log(`${label(options, "note   ")} ${options.targetNote ?? "none"}`);
  console.log(`${label(options, "verbose")} ${options.verbose ? "on" : "off"}`);
  console.log(`${label(options, "force  ")} ${options.force ? "on" : "off"}`);
  console.log(`${label(options, "sandbox")} ${options.noSandbox ? "off" : "default"}`);
  console.log(`${label(options, "color  ")} ${useColor(options) ? "on" : "off"}`);
}

function buildAssistantPreamble(options: Options): string {
  const vaultInstructions = options.vaultPath
    ? `Vault root:
${options.vaultPath}

Tool rule:
- Use Cursor read/grep/glob only for this harness repository and skill files.
- For content inside the Obsidian vault, use shell commands with working directory ${options.vaultPath} and run Obsidian CLI commands such as obsidian read, obsidian links, obsidian backlinks, and obsidian search:context.
- If Obsidian CLI fails, report the failure and ask before falling back to direct filesystem reads.`
    : `No Obsidian vault is configured. If the user asks for vault content, ask them to provide an absolute vault path or run /vault <path>.`;

  return `You are an Obsidian Visuals assistant running locally through the Cursor TypeScript SDK.

The user is chatting with you in a terminal REPL. Treat every user message as the next conversational turn. Do not start work until the user asks for something.

Use the local obsidian-visuals skill when the user asks for visual concepts, Luma prompts, generated previews, reference edits, or Obsidian note updates. The skill is installed at:
${SKILL_ROOT}

Read ${resolve(SKILL_ROOT, "SKILL.md")} before doing visual work. Read reference files under ${resolve(SKILL_ROOT, "references")} only when relevant.

${vaultInstructions}

${options.targetNote ? `Default note, only if the user refers to "the configured note" or does not provide another note:\n${options.targetNote}` : "No default note is configured. If the user asks for note-based work without naming a note, ask which note to use."}

Side-effect gates:
- Stop before calling Luma unless I approve the exact prompt or explicitly say to generate.
- Stop before enabling Luma web_search unless I approve web grounding for that generation.
- Stop before uploading a local reference image anywhere; prefer inline base64 source data when editing local images.
- Save previews only to this repo's ignored tmp/ folder.
- Stop before saving to the Obsidian Attachments folder unless I approve the specific preview.
- Stop before editing or prepending the note unless I approve the exact note action.
- Do not print API keys or .env contents.
- Default to no rendered text in the image.

Keep replies concise and conversational. Use short sections only when they help.`;
}

function buildLocalAgentOptions(options: Options): AgentOptions {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is missing. Add it to .env or the environment before running.");
  }

  return {
    apiKey,
    name: "Obsidian Visuals Terminal",
    model: { id: options.model },
    local: {
      cwd: options.vaultPath ? [ROOT, options.vaultPath] : ROOT,
      settingSources: ["project"],
      ...(options.noSandbox ? { sandboxOptions: { enabled: false } } : {}),
    },
  };
}

async function createLocalAgent(options: Options): Promise<SDKAgent> {
  const agent = options.agentId
    ? await Agent.resume(options.agentId, buildLocalAgentOptions(options))
    : await Agent.create(buildLocalAgentOptions(options));

  options.agentId = agent.agentId;
  return agent;
}

async function resumeLocalAgent(agentId: string, options: Options): Promise<SDKAgent> {
  const agent = await Agent.resume(agentId, buildLocalAgentOptions(options));
  options.agentId = agent.agentId;
  return agent;
}

async function sendAndStream(
  agent: SDKAgent,
  message: string,
  options: Options,
  withPreamble = false,
): Promise<RunResult> {
  const prompt = withPreamble
    ? `${buildAssistantPreamble(options)}\n\nUser message:\n${message}`
    : message;
  const run = await agent.send(prompt, {
    model: { id: options.model },
    local: options.force ? { force: true } : undefined,
  });

  const renderer = new TerminalRenderer(options);
  for await (const event of run.stream()) {
    renderer.render(event);
  }
  renderer.flush();

  const result = await run.wait();
  if (options.verbose || result.status !== "finished") {
    console.log(`\n[run ${result.id}: ${result.status}]`);
  }
  return result;
}

class TerminalRenderer {
  private assistantOpen = false;

  constructor(private readonly options: Options) {}

  render(event: SDKMessage): void {
    switch (event.type) {
      case "assistant":
        this.renderAssistant(event);
        break;
      case "tool_call":
        if (this.options.verbose) {
          this.logLine(`[tool:${event.name} ${event.status}]`);
        }
        break;
      case "task":
        if (event.text?.trim()) {
          this.logLine(`[task] ${event.text.trim()}`);
        }
        break;
      case "request":
        this.logLine(paint(this.options, "yellow", `[approval requested] ${event.request_id}`));
        break;
      case "thinking":
        if (this.options.verbose && event.text.trim()) {
          this.logLine(`[thinking] ${event.text.trim()}`);
        }
        break;
      case "status":
        if (this.options.verbose) {
          this.logLine(`[status] ${event.status}${event.message ? `: ${event.message}` : ""}`);
        }
        break;
      case "system":
      case "user":
        if (this.options.verbose) {
          this.logLine(`[${event.type}]`);
        }
        break;
    }
  }

  flush(): void {
    if (!this.assistantOpen) return;
    output.write("\n\n");
    this.assistantOpen = false;
  }

  private renderAssistant(event: Extract<SDKMessage, { type: "assistant" }>): void {
    const text = event.message.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (!text) return;

    if (!this.assistantOpen) {
      output.write(
        `\n${paint(this.options, "green", "agent")}${paint(this.options, "gray", "> ")} `,
      );
      this.assistantOpen = true;
    }
    output.write(styleAssistantText(this.options, text));
  }

  private logLine(line: string): void {
    this.flush();
    console.log(line);
  }
}

function styleAssistantText(options: Options, text: string): string {
  if (!useColor(options)) return text;

  return text
    .split("\n")
    .map((line) => {
      if (/^#{1,3}\s+/.test(line)) return paint(options, "bold", line);
      if (/^[-*]\s+/.test(line)) return line.replace(/^([-*])/, paint(options, "gray", "$1"));
      if (/^\s*(Next gate|Prompt|Preview|Context|Concepts)\b/i.test(line)) {
        return paint(options, "yellow", line);
      }
      return line;
    })
    .join("\n");
}

async function runConversation(options: Options): Promise<void> {
  installSdkLogFilter(options);
  const startsFromExistingAgent = Boolean(options.agentId);
  const session: Session = {
    agent: await createLocalAgent(options),
    needsPreamble: !startsFromExistingAgent,
    lastAgents: [],
    lastRuns: [],
  };
  const rl = createInterface({ input, output });

  printHeader(options);

  try {
    while (true) {
      const answer = await promptUser(
        rl,
        `${paint(options, "cyan", "you")}${paint(options, "gray", "> ")} `,
      );
      if (answer === null) break;

      const line = answer.trim();
      if (!line) continue;
      const commandResult = await handleCommand(line, options, session);
      if (commandResult === "exit") break;
      if (commandResult === "continue") continue;
      if (commandResult === "refresh-preamble") {
        session.needsPreamble = true;
        continue;
      }

      await sendAndStream(session.agent, line, options, session.needsPreamble);
      session.needsPreamble = false;
    }
  } finally {
    rl.close();
    session.agent.close();
  }
}

async function handleCommand(
  line: string,
  options: Options,
  session: Session,
): Promise<CommandResult | undefined> {
  if (!line.startsWith("/")) return undefined;

  const [command, ...parts] = line.split(/\s+/);
  const rest = line.slice(command.length).trim();

  switch (command) {
    case "/exit":
    case "/quit":
      return "exit";
    case "/help":
      printReplHelp(options);
      return "continue";
    case "/status":
      printStatus(options);
      return "continue";
    case "/models":
      await runCommand(options, async () => {
        await printModels(options, rest);
        return undefined;
      });
      return "continue";
    case "/model":
      return runCommand(options, () => setModel(options, rest));
    case "/agents":
      await runCommand(options, async () => {
        await printAgents(options, session, rest);
        return undefined;
      });
      return "continue";
    case "/resume":
      return runCommand(options, () => resumeAgentCommand(options, session, rest));
    case "/runs":
      await runCommand(options, async () => {
        await printRuns(options, session, rest || session.agent.agentId);
        return undefined;
      });
      return "continue";
    case "/run":
      await runCommand(options, async () => {
        await inspectRun(options, session, rest);
        return undefined;
      });
      return "continue";
    case "/debug":
      await runCommand(options, async () => {
        await debugCommand(options, session, rest);
        return undefined;
      });
      return "continue";
    case "/history":
      await runCommand(options, async () => {
        await printHistory(options, session, rest);
        return undefined;
      });
      return "continue";
    case "/clear":
      if (!options.plain) {
        output.write("\x1Bc");
      }
      printHeader(options);
      return "continue";
    case "/verbose":
      return setToggleCommand(options, "verbose", parts[0]);
    case "/plain":
      return setToggleCommand(options, "plain", parts[0]);
    case "/force":
      return setToggleCommand(options, "force", parts[0]);
    case "/note":
      return setNote(options, rest);
    case "/vault":
      return setVault(options, rest);
    default:
      console.log(paint(options, "red", `Unknown command: ${command}. Type /help.`));
      return "continue";
  }
}

async function runCommand(
  options: Options,
  command: () => Promise<CommandResult | undefined>,
): Promise<CommandResult> {
  try {
    return (await command()) ?? "continue";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(paint(options, "red", message));
    return "continue";
  }
}

function setToggleCommand(
  options: Options,
  key: "verbose" | "plain" | "force",
  value?: string,
): CommandResult {
  if (value === "on") {
    options[key] = true;
  } else if (value === "off") {
    options[key] = false;
  } else if (!value) {
    options[key] = !options[key];
  } else {
    console.log(paint(options, "red", `Use /${key} on or /${key} off.`));
    return "continue";
  }

  console.log(`${label(options, key)} ${options[key] ? "on" : "off"}`);
  return "refresh-preamble";
}

async function printModels(options: Options, filter: string): Promise<void> {
  const models = await loadModels(options);
  const query = filter.trim().toLowerCase();
  const visibleModels = query
    ? models.filter((model) =>
        [model.id, model.displayName, model.description ?? ""].some((value) =>
          value.toLowerCase().includes(query),
        ),
      )
    : models;

  if (visibleModels.length === 0) {
    console.log(paint(options, "yellow", `No models matched "${filter}".`));
    return;
  }

  console.log(paint(options, "bold", "Available models"));
  for (const model of visibleModels) {
    const marker = model.id === options.model ? paint(options, "green", "*") : " ";
    const name =
      model.displayName && model.displayName !== model.id
        ? ` ${paint(options, "gray", model.displayName)}`
        : "";
    const variants = model.variants?.length
      ? paint(
          options,
          "gray",
          ` variants: ${model.variants.map((variant) => variant.displayName).join(", ")}`,
        )
      : "";
    console.log(`${marker} ${model.id}${name}${variants}`);
  }
  console.log(paint(options, "gray", "Use /model <id> to select a model for future turns."));
}

async function setModel(options: Options, value: string): Promise<CommandResult> {
  const modelId = value.trim();
  if (!modelId) {
    console.log(`${label(options, "model")} ${options.model}`);
    console.log(paint(options, "gray", "Use /models to list available model ids."));
    return "continue";
  }

  const models = await loadModels(options);
  const selected = models.find((model) => model.id === modelId);
  if (!selected) {
    console.log(paint(options, "red", `Unknown model: ${modelId}`));
    console.log(paint(options, "gray", "Use /models to list available model ids."));
    return "continue";
  }

  options.model = selected.id;
  console.log(
    `${label(options, "model")} ${options.model}${selected.displayName !== selected.id ? ` ${paint(options, "gray", selected.displayName)}` : ""}`,
  );
  return "refresh-preamble";
}

async function loadModels(options: Options): Promise<SDKModel[]> {
  if (options.modelsCache) return options.modelsCache;

  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) {
    throw new Error(
      "CURSOR_API_KEY is missing. Add it to .env or the environment before listing models.",
    );
  }

  try {
    const models = await Cursor.models.list({ apiKey });
    options.modelsCache = models;
    return models;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to list Cursor models: ${message}`);
  }
}

async function printAgents(options: Options, session: Session, filter: string): Promise<void> {
  const query = filter.trim().toLowerCase();
  const response = await Agent.list({ runtime: "local", cwd: ROOT, limit: 30 });
  const agents = query
    ? response.items.filter((agent) =>
        [agent.agentId, agent.name, agent.summary ?? "", agent.status ?? ""].some((value) =>
          value.toLowerCase().includes(query),
        ),
      )
    : response.items;

  if (agents.length === 0) {
    console.log(
      paint(options, "yellow", query ? `No agents matched "${filter}".` : "No local agents found."),
    );
    return;
  }

  session.lastAgents = agents;
  console.log(paint(options, "bold", "Local agents"));
  for (const [index, agent] of agents.entries()) {
    console.log(formatAgentLine(options, agent, index + 1));
  }
  console.log(paint(options, "gray", "Use /resume <number> or /resume <agent-id> to continue."));
}

function formatAgentLine(options: Options, agent: SDKAgentInfo, index?: number): string {
  const marker = agent.agentId === options.agentId ? paint(options, "green", "*") : " ";
  const prefix = index === undefined ? marker : `${marker} ${String(index).padStart(2, " ")}`;
  const status = agent.status ?? "unknown";
  const modified = formatTimestamp(agent.lastModified);
  return `${prefix} ${agent.agentId} ${paintStatus(options, status)} ${modified} ${agent.name}`;
}

async function resumeAgentCommand(
  options: Options,
  session: Session,
  value: string,
): Promise<CommandResult> {
  if (!value.trim()) {
    await printAgents(options, session, "");
    return "continue";
  }

  const agentId = resolveAgentId(value, session);
  if (!agentId) {
    console.log(
      paint(options, "red", "Unknown agent selection. Use /agents, then /resume <number>."),
    );
    return "continue";
  }

  if (agentId === session.agent.agentId) {
    console.log(`${label(options, "agent")} already using ${agentId}`);
    return "continue";
  }

  const nextAgent = await resumeLocalAgent(agentId, options);
  session.agent.close();
  session.agent = nextAgent;
  session.needsPreamble = false;
  console.log(`${label(options, "agent")} resumed ${session.agent.agentId}`);
  console.log(
    paint(
      options,
      "gray",
      "Next message continues that existing conversation. Use /force on if its latest run is stuck.",
    ),
  );
  return "continue";
}

async function printRuns(options: Options, session: Session, agentId: string): Promise<void> {
  const targetAgentId = resolveAgentId(agentId, session);
  if (!targetAgentId) {
    console.log(paint(options, "red", "Use /runs, /runs <agent-id>, or /runs <agent-number>."));
    return;
  }

  const response = await Agent.listRuns(targetAgentId, { runtime: "local", cwd: ROOT, limit: 20 });
  if (response.items.length === 0) {
    console.log(paint(options, "yellow", `No runs found for ${targetAgentId}.`));
    return;
  }

  session.lastRuns = response.items;
  console.log(paint(options, "bold", `Runs for ${targetAgentId}`));
  for (const [index, run] of response.items.entries()) {
    console.log(formatRunLine(options, run, index + 1));
  }
  console.log(paint(options, "gray", "Use /run <number>, /run <run-id>, or /debug <number>."));
}

function formatRunLine(options: Options, run: Run, index?: number): string {
  const prefix = index === undefined ? "" : `${String(index).padStart(2, " ")} `;
  const model = run.model?.id ?? "unknown-model";
  const created = formatTimestamp(run.createdAt);
  return `${prefix}${run.id} ${paintStatus(options, run.status)} ${model} ${created}`;
}

async function inspectRun(options: Options, session: Session, value: string): Promise<void> {
  const runId = resolveRunId(value, session);
  if (!runId) {
    console.log(paint(options, "red", "Use /run <run-id>, or /runs then /run <number>."));
    return;
  }

  const run = await Agent.getRun(runId, { runtime: "local", cwd: ROOT });
  printRunSummary(options, run);

  if (run.status === "running") {
    console.log(
      paint(
        options,
        "yellow",
        "Run is still running; skipping conversation extraction to avoid blocking the TUI.",
      ),
    );
    return;
  }

  if (!run.supports("conversation")) {
    console.log(
      paint(
        options,
        "yellow",
        run.unsupportedReason("conversation") ??
          "Conversation inspection is not supported for this run.",
      ),
    );
    return;
  }

  const conversation = await run.conversation();
  printConversationSummary(options, conversation);
}

async function debugCommand(options: Options, session: Session, value: string): Promise<void> {
  const target = value.trim();
  if (!target || target === "last") {
    const response = await Agent.listRuns(session.agent.agentId, {
      runtime: "local",
      cwd: ROOT,
      limit: 1,
    });
    const [latestRun] = response.items;
    if (!latestRun) {
      console.log(paint(options, "yellow", `No runs found for ${session.agent.agentId}.`));
      return;
    }
    await inspectRun(options, session, latestRun.id);
    return;
  }

  const runId = resolveRunId(target, session);
  if (runId) {
    await inspectRun(options, session, runId);
    return;
  }

  const agentId = resolveAgentId(target, session);
  if (agentId) {
    const response = await Agent.listRuns(agentId, { runtime: "local", cwd: ROOT, limit: 1 });
    const [latestRun] = response.items;
    if (!latestRun) {
      console.log(paint(options, "yellow", `No runs found for ${agentId}.`));
      return;
    }
    await inspectRun(options, session, latestRun.id);
    return;
  }

  console.log(
    paint(
      options,
      "red",
      "Use /debug, /debug <run-id>, /debug <agent-id>, or a recent list number.",
    ),
  );
}

async function printHistory(options: Options, session: Session, value: string): Promise<void> {
  const { target, limit } = parseHistoryArgs(value);
  const agentId = resolveAgentId(target, session);
  if (!agentId) {
    console.log(
      paint(options, "red", "Use /history, /history <agent-id>, or /history <agent-number>."),
    );
    return;
  }

  const messages = await Agent.messages.list(agentId, { runtime: "local", cwd: ROOT, limit });
  if (messages.length === 0) {
    console.log(paint(options, "yellow", `No history found for ${agentId}.`));
    return;
  }

  console.log(paint(options, "bold", `History for ${agentId}`));
  for (const [index, message] of messages.entries()) {
    printHistoryMessage(options, index + 1, message);
  }
}

function parseHistoryArgs(value: string): { target: string; limit: number } {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const [target = "", rawLimit] = parts;
  const parsedLimit = rawLimit ? Number.parseInt(rawLimit, 10) : 20;
  return {
    target,
    limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 20,
  };
}

function printHistoryMessage(options: Options, index: number, message: AgentMessage): void {
  const value = getConversationTurnValue(message.message);
  const userText = extractUserText(value);
  const assistantTexts = collectAssistantTexts(value);
  const prefix = String(index).padStart(2, " ");

  if (userText) {
    console.log(
      `${paint(options, "gray", prefix)} ${paint(options, "cyan", "you")}   ${truncate(userText, 500)}`,
    );
  }

  const lastAssistantText = assistantTexts.at(-1);
  if (lastAssistantText) {
    console.log(
      `${paint(options, "gray", "  ")} ${paint(options, "green", "agent")} ${truncate(lastAssistantText, 800)}`,
    );
  }
}

function getConversationTurnValue(message: unknown): unknown {
  if (!isRecord(message)) return undefined;
  if (isRecord(message.turn) && "value" in message.turn) {
    return message.turn.value;
  }
  if ("agentConversationTurn" in message) return message.agentConversationTurn;
  if ("shellConversationTurn" in message) return message.shellConversationTurn;
  return undefined;
}

function extractUserText(value: unknown): string | undefined {
  if (!isRecord(value) || !isRecord(value.userMessage)) return undefined;
  if (typeof value.userMessage.text !== "string") return undefined;
  return stripInjectedPreamble(value.userMessage.text);
}

function stripInjectedPreamble(text: string): string {
  const marker = "\nUser message:\n";
  const markerIndex = text.lastIndexOf(marker);
  return (markerIndex === -1 ? text : text.slice(markerIndex + marker.length)).trim();
}

function collectAssistantTexts(value: unknown): string[] {
  const texts: string[] = [];
  walkObjects(value, (object) => {
    const assistantText = extractAssistantText(object);
    if (assistantText) {
      texts.push(assistantText);
    }
  });
  return texts;
}

function resolveAgentId(value: string, session: Session): string | undefined {
  const target = value.trim();
  if (!target) return session.agent.agentId;
  if (/^\d+$/.test(target)) {
    return session.lastAgents[Number(target) - 1]?.agentId;
  }
  return target.startsWith("agent-") ? target : undefined;
}

function resolveRunId(value: string, session: Session): string | undefined {
  const target = value.trim();
  if (!target) return undefined;
  if (/^\d+$/.test(target)) {
    return session.lastRuns[Number(target) - 1]?.id;
  }
  return target.startsWith("run-") ? target : undefined;
}

function printRunSummary(options: Options, run: Run): void {
  console.log(paint(options, "bold", "Run"));
  console.log(`${label(options, "id     ")} ${run.id}`);
  console.log(`${label(options, "agent  ")} ${run.agentId}`);
  console.log(`${label(options, "status ")} ${paintStatus(options, run.status)}`);
  console.log(`${label(options, "model  ")} ${run.model?.id ?? "unknown"}`);
  console.log(`${label(options, "created")} ${formatTimestamp(run.createdAt)}`);
  if (run.durationMs !== undefined) {
    console.log(`${label(options, "duration")} ${run.durationMs}ms`);
  }
  if (run.result) {
    console.log(`${label(options, "result ")} ${truncate(run.result, 500)}`);
  }
}

function printConversationSummary(options: Options, conversation: unknown[]): void {
  const summary = summarizeConversation(conversation);
  console.log(paint(options, "bold", "Conversation"));
  console.log(`${label(options, "turns  ")} ${conversation.length}`);
  console.log(`${label(options, "steps  ")} ${summary.stepCount}`);
  if (Object.keys(summary.toolCounts).length > 0) {
    const tools = Object.entries(summary.toolCounts)
      .map(([name, count]) => `${name}:${count}`)
      .join(", ");
    console.log(`${label(options, "tools  ")} ${tools}`);
  }
  if (summary.abortedCount > 0) {
    console.log(`${label(options, "aborts ")} ${summary.abortedCount}`);
  }
  if (summary.lastAssistantText) {
    console.log(`${label(options, "last   ")} ${truncate(summary.lastAssistantText, 1000)}`);
  }
}

function summarizeConversation(conversation: unknown[]): {
  stepCount: number;
  toolCounts: Record<string, number>;
  abortedCount: number;
  lastAssistantText?: string;
} {
  let stepCount = 0;
  let lastAssistantText: string | undefined;
  const toolCounts: Record<string, number> = {};
  const raw = JSON.stringify(conversation);
  const abortedCount = raw.match(/Aborted/g)?.length ?? 0;

  walkObjects(conversation, (value) => {
    if (Array.isArray(value.steps)) {
      stepCount += value.steps.length;
    }

    const assistantText = extractAssistantText(value);
    if (assistantText) {
      lastAssistantText = assistantText;
    }

    const toolName = extractToolName(value);
    if (toolName) {
      toolCounts[toolName] = (toolCounts[toolName] ?? 0) + 1;
    }
  });

  return { stepCount, toolCounts, abortedCount, lastAssistantText };
}

function walkObjects(value: unknown, visitor: (value: Record<string, unknown>) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walkObjects(item, visitor);
    return;
  }

  const object = value as Record<string, unknown>;
  visitor(object);
  for (const item of Object.values(object)) {
    walkObjects(item, visitor);
  }
}

function extractAssistantText(value: Record<string, unknown>): string | undefined {
  if (
    isRecord(value.message) &&
    value.message.case === "assistantMessage" &&
    isRecord(value.message.value)
  ) {
    return typeof value.message.value.text === "string" ? value.message.value.text : undefined;
  }
  if (value.type === "assistantMessage" && isRecord(value.message)) {
    return typeof value.message.text === "string" ? value.message.text : undefined;
  }
  if (isRecord(value.assistantMessage)) {
    return typeof value.assistantMessage.text === "string"
      ? value.assistantMessage.text
      : undefined;
  }
  return undefined;
}

function extractToolName(value: Record<string, unknown>): string | undefined {
  if (value.type === "toolCall" && isRecord(value.message)) {
    return typeof value.message.type === "string" ? value.message.type : "tool";
  }
  if (isRecord(value.toolCall)) {
    return Object.keys(value.toolCall).find((key) => key.endsWith("ToolCall")) ?? "tool";
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function paintStatus(options: Options, status: string): string {
  if (status === "finished") return paint(options, "green", status);
  if (status === "running") return paint(options, "yellow", status);
  if (status === "error" || status === "cancelled") return paint(options, "red", status);
  return status;
}

function formatTimestamp(value?: number): string {
  if (!value) return "unknown";
  return new Date(value).toISOString();
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, maxLength)}...[+${value.length - maxLength}]`
    : value;
}

function setNote(options: Options, value: string): CommandResult {
  if (!value || value === "none" || value === "clear") {
    options.targetNote = undefined;
    console.log(`${label(options, "note")} none`);
    return "refresh-preamble";
  }

  if (!options.vaultPath && !value.startsWith("/") && !value.startsWith("~/")) {
    console.log(paint(options, "red", "Set /vault <path> before using a relative note path."));
    return "continue";
  }

  const notePath = resolveUserPath(value, options.vaultPath ?? process.cwd());
  if (!existsSync(notePath)) {
    console.log(paint(options, "red", `Note not found: ${notePath}`));
    return "continue";
  }

  options.targetNote = notePath;
  console.log(`${label(options, "note")} ${options.targetNote}`);
  return "refresh-preamble";
}

function setVault(options: Options, value: string): CommandResult {
  if (!value) {
    console.log(paint(options, "red", "Use /vault <path>."));
    return "continue";
  }

  const vaultPath = resolveUserPath(value, process.cwd());
  if (!existsSync(vaultPath)) {
    console.log(paint(options, "red", `Vault path not found: ${vaultPath}`));
    return "continue";
  }

  options.vaultPath = vaultPath;
  if (options.targetNote && !options.targetNote.startsWith(vaultPath)) {
    options.targetNote = undefined;
  }
  console.log(`${label(options, "vault")} ${options.vaultPath}`);
  if (!options.targetNote) {
    console.log(`${label(options, "note ")} none`);
  }
  return "refresh-preamble";
}

function resolveUserPath(value: string, basePath: string): string {
  const normalized = value.replace(/\\ /g, " ");
  const expanded = normalized.startsWith("~/")
    ? resolve(process.env.HOME ?? "", normalized.slice(2))
    : normalized;
  return expanded.startsWith("/") ? resolve(expanded) : resolve(basePath, expanded);
}

function installSdkLogFilter(options: Options): void {
  if (options.verbose) return;

  const originalWrite = process.stdout.write.bind(process.stdout) as (
    ...args: unknown[]
  ) => boolean;
  process.stdout.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: unknown,
    callback?: unknown,
  ) => {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    if (
      text.includes("LocalCursorRulesService load completed") ||
      text.includes("AgentSkillsCursorRulesService load completed")
    ) {
      return true;
    }
    return originalWrite(chunk, encodingOrCallback, callback);
  }) as typeof process.stdout.write;
}

async function promptUser(
  rl: ReturnType<typeof createInterface>,
  query: string,
): Promise<string | null> {
  try {
    return await rl.question(query);
  } catch (error) {
    if (isReadlineClosedError(error)) {
      return null;
    }
    throw error;
  }
}

function isReadlineClosedError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("readline was closed") ||
      ("code" in error && error.code === "ERR_USE_AFTER_CLOSE"))
  );
}

function printReplHelp(options: Options): void {
  console.log(`${paint(options, "bold", "Commands")}
  /help             Show this message.
  /status           Show model, vault, note, and flags.
  /models [filter]  List Cursor models available for this API key.
  /model <id>       Select the model used for future turns.
  /agents [filter]  List numbered local Cursor SDK agents for this workspace.
  /resume [target]  Resume by number from /agents or by agent id.
  /runs [target]    List numbered runs for the current or selected agent.
  /run <target>     Inspect a run by number from /runs or by run id.
  /debug [target]   Inspect the latest run, an agent's latest run, or a run id.
  /history [target] Show recent stored messages for the current or selected agent.
  /note <path>      Set current note. Use /note none to clear.
  /vault <path>     Set vault root and refresh assistant context.
  /verbose on|off   Show or hide status/thinking/tool events.
  /plain on|off     Disable or enable ANSI terminal styling.
  /force on|off     Expire a stuck local run before each send.
  /clear            Clear the terminal and redraw the header.
  /exit             End the conversation.

Everything else is sent to the same Cursor SDK agent conversation.
Examples:
  make a cover concept for Zettelkasten/My Essay.md
  use the configured note and propose three cover directions
  revise concept 2 to be darker and less literal

Use explicit gates such as:
  approved: generate this prompt
  approved: save this preview to Attachments
  approved: prepend the saved image to the note`);
}

async function main(): Promise<void> {
  loadEnvFile(resolve(ROOT, ".env"));
  const options = parseArgs(process.argv.slice(2));

  if (options.checkOnly) {
    const ok = checkConfiguration(options);
    process.exit(ok ? 0 : 1);
  }

  await runConversation(options);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exit(1);
});
