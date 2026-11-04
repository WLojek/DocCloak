/**
 * Where users send feedback on a detection model (T250): the GitHub issue form
 * .github/ISSUE_TEMPLATE/model-feedback.yml of the web app's repository. GitHub fills an issue
 * form field from the query parameter named like the field's id.
 */

const NEW_ISSUE_URL = 'https://github.com/WLojek/DocCloak/issues/new';
const TEMPLATE = 'model-feedback.yml';

/** The feedback form, with the model and app version filled in when given. */
export function modelFeedbackUrl(model?: string, version?: string): string {
  const query = new URLSearchParams({ template: TEMPLATE });
  if (model) {
    query.set('title', `Model feedback: ${model}`);
    query.set('model', model);
  }
  if (version) query.set('version', version);
  return `${NEW_ISSUE_URL}?${query.toString()}`;
}
