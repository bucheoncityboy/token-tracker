// token-tracker — Accurate token counting via tiktoken
//
// Maps model names to encodings. Always creates fresh encodings and expects
// the caller to free them. The convenience count() frees automatically.

const { get_encoding, encoding_for_model } = require('tiktoken');

// Model → encoding name mapping (for models not recognized by encoding_for_model)
const MODEL_ENCODING_MAP = [
  // o200k_base models
  ['gpt-4o',        'o200k_base'],
  ['gpt-4-turbo',   'o200k_base'],
  ['o1-',           'o200k_base'],
  ['o3-',           'o200k_base'],
  // cl100k_base models
  ['gpt-4',         'cl100k_base'],
  ['gpt-3.5',       'cl100k_base'],
  ['text-',         'cl100k_base'],
  // Non-OpenAI models — best approximation
  ['claude',        'cl100k_base'],
  ['gemini',        'cl100k_base'],
];

/**
 * Get the appropriate encoding for a model.
 * Always creates a fresh encoding. Caller MUST free() it.
 */
function getEncodingForModel(model) {
  if (!model) return null;

  const lower = model.toLowerCase();

  // Try model-specific encoding first (works for exact OpenAI model names)
  try {
    const enc = encoding_for_model(lower);
    return enc;
  } catch {
    // Model not recognized — fall back to prefix matching
  }

  // Prefix match
  for (const [prefix, encodingName] of MODEL_ENCODING_MAP) {
    if (lower.startsWith(prefix)) {
      try {
        return get_encoding(encodingName);
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Count tokens in text for a given model.
 * Returns { tokens: number, encoder: Tiktoken|null }.
 * The encoder MUST be freed by caller via encoder.free().
 */
function countTokens(text, model) {
  if (!text) return { tokens: 0, encoder: null };

  const enc = getEncodingForModel(model || '');
  if (enc) {
    const tokens = enc.encode(text).length;
    return { tokens, encoder: enc };
  }

  // Fallback: character-based estimation
  let ascii = 0, nonAscii = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else nonAscii++;
  }
  const est = Math.round(ascii / 4 + nonAscii / 1.5);
  return { tokens: est, encoder: null };
}

/**
 * Convenience: count tokens and free the encoder immediately.
 */
function count(text, model) {
  const { tokens, encoder } = countTokens(text, model);
  if (encoder) encoder.free();
  return tokens;
}

module.exports = { countTokens, count, getEncodingForModel };
