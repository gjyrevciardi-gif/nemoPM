/**
 * Splits a compound request into single-step sub-turns.
 *
 * "Create a task called Refund emails, then put it in Sprint Beta" is one
 * sentence and two actions, and every local model measured on this hardware
 * does the first and stops, or invents arguments for the second. The eval data
 * says prompting will not fix that: a 2GB VRAM ceiling is not a prompt problem,
 * and asking a model to hold two pending actions in one context window is
 * asking for the thing it is worst at.
 *
 * So the splitting is done here, deterministically, and each step goes through
 * the whole ordinary pipeline -- routing, permissions, domain operation. This is
 * orchestration, not a new trust surface: nothing here can execute anything, and
 * a step that needs approval still gets it.
 */

/** Conjunctions that join two instructions rather than two nouns. */
const STEP_SEPARATOR =
  /,?\s*\b(?:and\s+then|then|after\s+that|afterwards|and\s+also|,\s*also)\b\s*/i;

/**
 * A second clause is only a step if it reads like an instruction. "Create a task
 * and then we can discuss it" is one action and an aside.
 */
const IMPERATIVE =
  /^\s*(?:please\s+)?(?:create|add|open|file|log|make|put|move|assign|set|update|change|mark|record|remove|delete|plan|start|complete|carry|break|link)\b/i;

const MAX_STEPS = 3;

export interface StepPlan {
  /** True when the message was genuinely compound and worth splitting. */
  isMultiStep: boolean;
  steps: string[];
}

export function planSteps(message: string): StepPlan {
  const parts = message
    .split(STEP_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) return { isMultiStep: false, steps: [message] };

  // The first clause carries the original intent; every later clause has to
  // stand on its own as an instruction, or this is one request with a comment
  // attached rather than two requests.
  const [first, ...rest] = parts;
  if (!rest.every((part) => IMPERATIVE.test(part))) return { isMultiStep: false, steps: [message] };

  const steps = [first!, ...rest].slice(0, MAX_STEPS);
  return { isMultiStep: true, steps };
}

/**
 * Threads what the previous step did into the next one.
 *
 * "Then put it in Sprint Beta" is unresolvable on its own -- "it" was created a
 * moment ago and the model has no memory of that between sub-turns. Naming the
 * result explicitly is what makes each step answerable in isolation, which is
 * the entire point of splitting them.
 */
export function contextualiseStep(step: string, previousSummaries: string[]): string {
  if (previousSummaries.length === 0) return step;
  const done = previousSummaries.map((summary) => `- ${summary}`).join("\n");
  return `Already done in this request:\n${done}\n\nNow do only this, and nothing else: ${step}`;
}
