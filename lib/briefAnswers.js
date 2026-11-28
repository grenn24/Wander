/*
 * Answers to the planner's questions before it plans.
 *
 * A "choice" question has one answer, a string. A "multi" question ("Which
 * countries?") has a list: Norway and Sweden, not Norway only. "No
 * preference" stands alone in a list. Ticking it clears the rest, and ticking
 * anything else clears it.
 */

const OPEN = /^no preference$/i;

/** The list after `option` was ticked or unticked. */
export function tickAnswer(picked, option) {
  const was = Array.isArray(picked) ? picked : [];
  if (was.includes(option)) return was.filter((x) => x !== option);
  if (OPEN.test(option)) return [option];
  return [...was.filter((x) => !OPEN.test(x)), option];
}

/** Whether a question has been answered at all. */
export function isAnswered(answer) {
  return Array.isArray(answer) ? answer.length > 0 : !!String(answer || '').trim();
}

/** The answer as the planner reads it: "Norway, Sweden". */
export function answerText(answer) {
  return Array.isArray(answer) ? answer.join(', ') : String(answer || '').trim();
}
