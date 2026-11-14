type SkillRecord = { id: string; version: number; body: any };

/** Shared deterministic ranking for MCP recommendations and the read-only Inspector. */
export function recommendSkills(skills: SkillRecord[], source: string) {
  const tokens = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const context = tokens(source);
  const containsPhrase = (phrase: string) => {
    const expected = tokens(phrase);
    if (!expected.length || expected.length > context.length) return false;
    for (let start = 0; start <= context.length - expected.length; start++) {
      if (expected.every((word, index) => context[start + index] === word)) return true;
    }
    return false;
  };
  return skills.filter(skill => skill.body.status === 'active').map(skill => {
    const matchedTriggers = (skill.body.triggers ?? []).filter(containsPhrase);
    const matchedTags = (skill.body.tags ?? []).filter(containsPhrase);
    const matchedScopes = (skill.body.applies_to ?? []).filter(containsPhrase);
    const score = matchedTriggers.length * 4 + matchedTags.length * 2 + matchedScopes.length;
    const reasons = [
      ...matchedTriggers.map((value: string) => `task text contains trigger “${value}”`),
      ...matchedTags.map((value: string) => `task text matches tag “${value}”`),
      ...matchedScopes.map((value: string) => `task text matches applicability “${value}”`),
    ];
    return { id: skill.id, version: skill.version, title: skill.body.title, description: skill.body.description,
      source: skill.body.source, score, reasons };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}
