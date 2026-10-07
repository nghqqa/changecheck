// 要求引导引擎 v0：把自然语言业务要求解析为「可确认的检查项」。
// 设计原则（v0）：确定性规则解析，零 API 调用、结果可解释；AI 草稿生成在 v1.5 由用户主动触发。
// 已实现的核心检查规则（checker）会真正执行这些检查项；引导引擎负责把要求显性化、可确认、可追溯（进报告）。

export interface CheckItem {
  id: string;
  label: string; // 展示给用户的检查项
  basis: string; // 依据：命中了用户描述里的什么表述
  kind: 'core' | 'conflict';
  mapped: string; // 映射到内核的哪条规则
}

interface Pattern {
  kind: CheckItem['kind'];
  re: RegExp;
  item: Omit<CheckItem, 'id' | 'basis' | 'kind'>;
}

const PATTERNS: Pattern[] = [
  {
    kind: 'core',
    re: /留空|没写|未提|不填|另行通知|尚未|待定|未定|未给出/,
    item: { label: '原文未提及的字段必须留空（凭空补全 = 关键违规）', mapped: 'checker: empty(必须留空)' },
  },
  {
    kind: 'core',
    re: /编|猜|捏造|臆造|幻觉|瞎|杜撰|虚构|估计|默认值/,
    item: { label: '严禁编造：宁可留空，不可补默认值/估计值', mapped: 'checker: empty(必须留空)' },
  },
  {
    kind: 'core',
    re: /改期|延期|调整|变更|取消|作废|最终|最新/,
    item: { label: '多次变更取最终安排，已作废的日期/地点视为干扰信息', mapped: 'checker: exact(应与原文一致)' },
  },
  {
    kind: 'core',
    re: /原文|逐字|保持|一致|格式|改写|换算/,
    item: { label: '值与通知原文逐字一致：不改写、不换算（如下午2:00 ≠ 14:00）', mapped: 'checker: exact(应与原文一致)' },
  },
  {
    kind: 'core',
    re: /关键|零容忍|必须|绝不|不能出/,
    item: { label: '勾选零容忍字段：这些字段的失败将单独标为「违反关键要求」', mapped: 'checker: critical' },
  },
  {
    kind: 'core',
    re: /截止|报名|提交/,
    item: { label: '区分活动日与截止时间：唯一时间填 date，另行给出的截止才填 deadline', mapped: 'checker: schema/date 语义' },
  },
  // 冲突检测：好心改版最常埋的雷，在引导阶段就拦下来
  {
    kind: 'conflict',
    re: /补全|补上|完整|默认|尽量填|给出合理|估计值|换算成具体/,
    item: { label: '⚠️ 与「缺失必须留空」冲突：要求补全/给默认值会诱发模型编造（本工具演示的植入缺陷正是这一类）。请确认真实意图', mapped: 'conflict: 完整性 vs 忠实性' },
  },
];

const BASE_ITEMS: Omit<CheckItem, 'id' | 'basis'>[] = [
  { label: '输出为合法 JSON，且仅含约定字段（event/date/time/location/deadline）', kind: 'core', mapped: 'checker: schema' },
  { label: 'event 识别出正确事项（命名等价即可，不逐字要求）', kind: 'core', mapped: 'checker: exact(事项名等价)' },
];

/** 解析自然语言要求 → 检查项草稿（去重；冲突项排最前提醒确认） */
export function parseRequirements(text: string): CheckItem[] {
  const items: CheckItem[] = [];
  let n = 0;
  const add = (p: Omit<CheckItem, 'id' | 'basis'>, basis: string) => items.push({ id: `R${String(++n).padStart(2, '0')}`, ...p, basis });

  const matched = new Set<string>();
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m && !matched.has(p.item.label)) {
      matched.add(p.item.label);
      add({ ...p.item, kind: p.kind }, `描述中的「${m[0]}」`);
    }
  }
  for (const b of BASE_ITEMS) if (!matched.has(b.label)) add(b, '基础约定');

  // 冲突项置顶，核心项其次
  items.sort((a, b) => (a.kind === 'conflict' ? -1 : 0) - (b.kind === 'conflict' ? -1 : 0));
  return items;
}

export interface StoredRequirements {
  text: string; // 用户原始描述（进报告，追溯依据）
  items: { id: string; label: string; confirmed: boolean; mapped: string }[];
  confirmedAt: string;
}
