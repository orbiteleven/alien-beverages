// LLM integration — a thin client for OpenRouter's chat-completions API.
//
// Dependency-free on purpose: Node 20's global fetch does the work.
// Configured from the environment (see .env.example at the repo root).

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "anthropic/claude-sonnet-5";
const DEFAULT_TIMEOUT_MS = 20_000;

// Optional OpenRouter attribution headers. Cosmetic — safe to change.
const APP_URL = "http://localhost:5173";
const APP_TITLE = "Spaceport Bar";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatOptions = {
  /** Overrides the client's configured model for this call only. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

export type LlmClientConfig = {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
};

export type LlmClient = {
  /** False when no API key is configured; chat() throws in that case. */
  isConfigured: boolean;
  /** Model slug this client sends to — useful for logging. */
  model: string;
  /** Send messages, get the assistant's reply as text. */
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<string>;
  /** Same, but asks for JSON mode and parses the reply. */
  chatJson<T = unknown>(messages: ChatMessage[], options?: ChatOptions): Promise<T>;
};

/** The subset of the OpenRouter response we care about. */
type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string; code?: number };
};

/**
 * Read an environment variable, treating blank values as unset.
 *
 * docker-compose passes `LLM_API_KEY=${LLM_API_KEY:-}`, so the variable is
 * always present in the container — as an empty string when nobody set it.
 * A plain `??` would happily hand that empty string back as a real value.
 */
function readEnv(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value ? value : undefined;
}

/** Like readEnv, but only accepts a finite positive number. */
function readIntEnv(key: string): number | undefined {
  const raw = readEnv(key);
  if (raw === undefined) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Drop a ```json ... ``` wrapper, which models emit even in JSON mode. */
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "")
    .trim();
}

/**
 * Build an OpenRouter client.
 *
 * Configuration precedence is explicit config → environment → default:
 *   - apiKey    LLM_API_KEY     (no default; required to make a call)
 *   - model     LLM_MODEL       anthropic/claude-sonnet-5
 *   - baseUrl   LLM_BASE_URL    https://openrouter.ai/api/v1
 *   - timeoutMs LLM_TIMEOUT_MS  20000
 *
 * This never throws, even without an API key — check `isConfigured` if you
 * want to know up front. Calling chat() without a key throws immediately
 * rather than making a doomed request.
 */
export function createLlmClient(config: LlmClientConfig = {}): LlmClient {
  const apiKey = config.apiKey ?? readEnv("LLM_API_KEY");
  const model = config.model ?? readEnv("LLM_MODEL") ?? DEFAULT_MODEL;
  const timeoutMs = config.timeoutMs ?? readIntEnv("LLM_TIMEOUT_MS") ?? DEFAULT_TIMEOUT_MS;
  const baseUrl = (config.baseUrl ?? readEnv("LLM_BASE_URL") ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    "",
  );

  async function complete(
    messages: ChatMessage[],
    options: ChatOptions,
    responseFormat?: { type: "json_object" },
  ): Promise<string> {
    if (!apiKey) {
      throw new Error(
        "LLM_API_KEY is not set — copy .env.example to .env and add your OpenRouter key.",
      );
    }

    const body = {
      model: options.model ?? model,
      messages,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
      ...(responseFormat ? { response_format: responseFormat } : {}),
    };

    // No retries. In production, 429 and 5xx would be the ones worth retrying
    // with backoff — for this app, failing fast keeps the error legible.
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": APP_URL,
          "X-Title": APP_TITLE,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Network failure, or the timeout above firing (a TimeoutError).
      throw new Error(`LLM request failed: ${(err as Error).message}`, { cause: err });
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `LLM request failed (${response.status} ${response.statusText}): ${detail.slice(0, 500)}`,
      );
    }

    const payload = (await response.json()) as ChatCompletionResponse;

    // OpenRouter can return 200 with an error envelope instead of choices.
    if (payload.error) {
      throw new Error(`LLM returned an error: ${payload.error.message ?? "unknown"}`);
    }

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.length === 0) {
      throw new Error(
        `LLM response had no message content: ${JSON.stringify(payload).slice(0, 500)}`,
      );
    }

    return content;
  }

  return {
    isConfigured: Boolean(apiKey),
    model,

    chat(messages, options = {}) {
      return complete(messages, options);
    },

    /**
     * The result is cast to T without runtime validation — the model can
     * return any shape it likes, so narrow it yourself before trusting it.
     */
    async chatJson<T = unknown>(messages: ChatMessage[], options: ChatOptions = {}): Promise<T> {
      const raw = await complete(messages, options, { type: "json_object" });
      try {
        return JSON.parse(stripCodeFence(raw)) as T;
      } catch (err) {
        throw new Error(`LLM did not return valid JSON: ${raw.slice(0, 300)}`, { cause: err });
      }
    },
  };
}
