import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export type SetupContext = 'missing' | 'invalid' | 'unknown';

interface SetupBlock {
  header: string;
  diagnosis: string;
  step1: string;
}

interface SetupMessages {
  setup: {
    missing: SetupBlock;
    invalid: SetupBlock;
    unknown: SetupBlock;
    config_instructions: string;
    footer: string;
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const yamlPath = join(__dirname, '..', 'messages.yaml');

let _cached: SetupMessages | null = null;
function loadMessages(): SetupMessages {
  if (_cached) return _cached;
  _cached = parseYaml(readFileSync(yamlPath, 'utf-8')) as SetupMessages;
  return _cached;
}

function detectContext(): SetupContext {
  const hasKey = !!process.env.OPENAI_API_KEY;
  const isOllama = process.env.EMBEDDING_PROVIDER === 'ollama';
  if (!hasKey && !isOllama) return 'missing';
  return 'invalid';
}

export function getSetupErrorMessage(errorDetail: string, context?: SetupContext): string {
  const ctx = context ?? detectContext();
  const msgs = loadMessages();
  const block = msgs.setup[ctx];

  const header = block.header.replace('{error}', errorDetail);
  const diagnosis = block.diagnosis.trim() ? `**Diagnosis:** ${block.diagnosis.trim()}\n\n` : '';

  return (
    `${header}\n\n` +
    diagnosis +
    '## How to fix\n\n' +
    `1. ${block.step1}\n` +
    '2. **Set or update your config** (pick one):\n\n' +
    msgs.setup.config_instructions +
    `3. ${msgs.setup.footer}`
  );
}

// Called by plugin/hooks/session-start.sh
if (process.argv[1] === __filename) {
  const context = (process.argv[2] as SetupContext | undefined) ?? 'missing';
  const detail = process.argv[3] ?? 'OPENAI_API_KEY is not set.';
  console.log(JSON.stringify({ additionalContext: getSetupErrorMessage(detail, context) }));
}
