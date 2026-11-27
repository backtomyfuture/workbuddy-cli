// Reasoning effort for the WorkBuddy product gateway.
// Levels match codebuddy VALID_REASONING_EFFORTS. The picker default matches
// filterEffortLevelsForPicker when a model has no supportedEfforts.

export const EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const DEFAULT_PICKER = ['low', 'medium', 'high', 'xhigh'];

const LABELS = {
  minimal: '极简',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '很高',
  max: '最高',
  off: '关闭'
};

// null: the catalog says this model does not reason.
// efforts: supportedEfforts from product.internal.json.
// onlyReasoning: cannot send "none". canDisableThinking is ignored when this is set.
const PROFILES = {
  auto: null,
  'deepseek-v3-2-volc': { defaultEffort: 'medium', onlyReasoning: true },
  'deepseek-v4-flash': { defaultEffort: 'high', onlyReasoning: true },
  'deepseek-v4.1-flash': { defaultEffort: 'high', onlyReasoning: true },
  'deepseek-v4-pro': { defaultEffort: 'high', onlyReasoning: true },
  'glm-5.3': { defaultEffort: 'medium', onlyReasoning: true },
  'glm-5.3-flash': { defaultEffort: 'high', efforts: ['low', 'high', 'max'], onlyReasoning: true },
  'glm-5.3-flashx': { defaultEffort: 'high', efforts: ['low', 'high', 'max'], onlyReasoning: true },
  'kimi-k2.5': { defaultEffort: 'medium', onlyReasoning: true },
  'kimi-k2.8-preview': { defaultEffort: 'high', efforts: ['low', 'high', 'max'], onlyReasoning: true },
  'minimax-m3-pay': { defaultEffort: 'medium', onlyReasoning: true },
  'hy4-preview': { defaultEffort: 'high', efforts: ['high'], onlyReasoning: true },
  'hy4-preview-x': { defaultEffort: 'high', efforts: ['high'], onlyReasoning: true },
  'fast-model': { defaultEffort: 'medium', onlyReasoning: true },
  'balanced-model': { defaultEffort: 'medium', onlyReasoning: true },
  'deep-model': { defaultEffort: 'medium', onlyReasoning: true }
};

export function parseEffort(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  if (text === 'off' || text === 'disabled' || text === 'none') return 'off';
  if (EFFORT_LEVELS.includes(text)) return text;
  return undefined;
}

const runtimeProfiles = new Map();

// Live catalog wins over the static table. null means the model does not reason.
export function installModelProfiles(models) {
  runtimeProfiles.clear();
  for (const model of Array.isArray(models) ? models : []) {
    if (!model || typeof model.id !== 'string' || !model.id) continue;
    runtimeProfiles.set(model.id, profileFromRemote(model));
  }
}

function profileFromRemote(model) {
  const reasoning = model.reasoning && typeof model.reasoning === 'object' ? model.reasoning : null;
  if (model.supportsReasoning !== true && !reasoning) return null;
  const listed = Array.isArray(reasoning?.supportedEfforts)
    ? reasoning.supportedEfforts.filter(level => EFFORT_LEVELS.includes(level))
    : [];
  const defaultEffort = [reasoning?.defaultEffort, reasoning?.effort]
    .find(level => EFFORT_LEVELS.includes(level));
  return {
    defaultEffort,
    efforts: listed.length ? listed : undefined,
    onlyReasoning: model.onlyReasoning === true || reasoning?.canDisableThinking === false
  };
}

function profileOf(modelId) {
  if (runtimeProfiles.has(modelId)) return runtimeProfiles.get(modelId);
  if (Object.prototype.hasOwnProperty.call(PROFILES, modelId)) return PROFILES[modelId];
  return undefined;
}

export function effortChoices(modelId) {
  const profile = profileOf(modelId);
  if (profile === null) return [];
  const levels = profile?.efforts || DEFAULT_PICKER;
  const choices = levels
    .filter(level => EFFORT_LEVELS.includes(level))
    .map(value => ({ value, name: LABELS[value] || value }));
  if (profile?.onlyReasoning) return choices;
  return [...choices, { value: 'off', name: LABELS.off }];
}

export function defaultEffort(modelId) {
  const profile = profileOf(modelId);
  if (profile === null) return null;
  if (profile?.defaultEffort && effortChoices(modelId).some(choice => choice.value === profile.defaultEffort)) {
    return profile.defaultEffort;
  }
  const choices = effortChoices(modelId);
  return choices.find(choice => choice.value === 'medium')?.value || choices.find(choice => choice.value !== 'off')?.value || null;
}

export function resolveEffort(modelId, requested) {
  const choices = effortChoices(modelId);
  if (!choices.length) {
    if (requested) return { effort: null, error: `模型 ${modelId} 不支持思考等级` };
    return { effort: null };
  }
  if (requested == null) {
    return { effort: defaultEffort(modelId) };
  }
  if (!choices.some(choice => choice.value === requested)) {
    const allowed = choices.map(choice => choice.value).join(', ');
    return { effort: null, error: `模型 ${modelId} 的思考等级只能是 ${allowed}` };
  }
  return { effort: requested };
}

export function reconcileEffort(modelId, current) {
  const choices = effortChoices(modelId);
  if (!choices.length) return null;
  if (current && choices.some(choice => choice.value === current)) return current;
  return defaultEffort(modelId);
}

export function applyReasoning(payload, effort) {
  if (!effort) return payload;
  if (effort === 'off') {
    payload.reasoning_effort = 'none';
    delete payload.reasoning;
    return payload;
  }
  payload.reasoning_effort = effort;
  payload.reasoning = { effort, summary: 'auto' };
  return payload;
}

export function modelMeta(modelId, currentEffort) {
  const choices = effortChoices(modelId).filter(choice => choice.value !== 'off');
  if (!choices.length) return { supportsReasoningEffort: false };
  const current = choices.some(choice => choice.value === currentEffort)
    ? currentEffort
    : defaultEffort(modelId);
  return {
    supportsReasoningEffort: true,
    reasoningEfforts: choices.map(choice => ({ value: choice.value, label: choice.name })),
    reasoningEffort: current || choices[0].value
  };
}
