// Shape the account model catalog for the CLI and the T3 ACP picker.
// Media models stay in `workbuddy models` but cannot be the coding model.

const MEDIA_TAG = /^(?:text|image)-to-(?:image|video)$/;

export function isChatModel(model) {
  if (!model || typeof model.id !== 'string' || !model.id) return false;
  const tags = Array.isArray(model.tags) ? model.tags.map(String) : [];
  if (tags.some(tag => MEDIA_TAG.test(tag))) return false;
  return model.supportsToolCall === true;
}

function displayName(model, nameCount) {
  const base = model.name || model.id;
  if ((nameCount.get(base) || 0) < 2) return base;
  const badge = (Array.isArray(model.tags) ? model.tags : [])
    .map(String)
    .find(tag => tag.startsWith('badge:'));
  const badgeLabel = badge?.split(':')[1];
  if (badgeLabel) return `${base}（${badgeLabel}）`;
  if (model.credits) return `${base}（${String(model.credits).replace(/\s*credits?$/i, '')}）`;
  return `${base}（${model.id}）`;
}

export function acpModelsFromCatalog(models) {
  const chat = (Array.isArray(models) ? models : []).filter(isChatModel);
  const nameCount = new Map();
  for (const model of chat) {
    const base = model.name || model.id;
    nameCount.set(base, (nameCount.get(base) || 0) + 1);
  }
  return chat.map(model => ({
    modelId: model.id,
    name: displayName(model, nameCount)
  }));
}

export function accountDefaultModel(models) {
  const chat = (Array.isArray(models) ? models : []).filter(isChatModel);
  return chat.find(model => model.isDefault === true)?.id || null;
}
