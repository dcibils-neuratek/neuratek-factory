-- Neuratek Factory. Copyright (c) 2026 Diego Cibils. MIT; see LICENSE.
-- The demo project, which every signed-in person sees as a viewer: a banking
-- app's account opening, planned and half built - cards in every column,
-- the queue, two agents at work, a discussion, decisions answered and one
-- open, notes between people and agents. Everything in it is made up.
--
-- Applied with `wrangler d1 execute neuratek-factory --remote --file demo.sql`.
-- Its times are relative to when it is applied, so it reads as a morning's
-- work; applied again, it is made again from nothing.

DELETE FROM notes WHERE card IN (SELECT id FROM cards WHERE project = 'demo');
DELETE FROM owners WHERE card IN (SELECT id FROM cards WHERE project = 'demo');
DELETE FROM messages WHERE discussion IN (SELECT id FROM discussions WHERE project = 'demo');
DELETE FROM cards WHERE project = 'demo';
DELETE FROM queue WHERE project = 'demo';
DELETE FROM decisions WHERE project = 'demo';
DELETE FROM discussions WHERE project = 'demo';
DELETE FROM doing WHERE project = 'demo';
DELETE FROM changes WHERE project = 'demo';
DELETE FROM mentions WHERE project = 'demo';
DELETE FROM projects WHERE id = 'demo';

INSERT INTO projects (id, name, detail, rank, created, author, everyone) VALUES
  ('demo', 'Demo: opening a bank account',
   'An example everyone can look at: the account opening of a banking app, planned and half built by people and agents. Read the cards, the queue, the discussion and the decisions to see how work moves through Factory. It is made up, and read only.',
   -1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-9 days'), 'Factory', 'viewer');

-- The cards, column by column. `asked` is the day it was asked for.
INSERT INTO cards (id, project, title, col, rank, area, ref, detail, quote, asked, in_roadmap, created, updated, updated_by) VALUES
  ('demo-welcome', 'demo', 'Welcome screen and choice of account', 'done', 1, 'App', 'A1',
   'The first screen of the opening: what a current account and a savings account are, and the button that starts. Done when a person can choose one and land on the form.',
   'People should know what they are opening before they type anything.', date('now', '-9 days'), 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-9 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days'), 'Claude (Marta)'),
  ('demo-details', 'demo', 'Personal details form', 'done', 2, 'App', 'A2',
   'Name, date of birth, nationality, address and tax number, checked as they are typed. Kept on the device until the applicant sends it.',
   '', date('now', '-9 days'), 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-9 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'), 'Claude (Marta)'),
  ('demo-sms', 'demo', 'Phone number verified by an SMS code', 'done', 3, 'Identity', 'I1',
   'Six digits, valid for five minutes, three tries; a new code after thirty seconds. The number becomes the account''s second factor.',
   '', date('now', '-8 days'), 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), 'Gemini (Tomás)'),

  ('demo-scan', 'demo', 'Identity document scan and selfie match', 'building', 1, 'Identity', 'I2',
   'The applicant photographs both sides of their ID and takes a selfie; the document is read, checked for tampering, and its photo matched to the selfie. Done when the five test applicants in the fixtures pass and the two forged ones are refused.',
   'Most people give up at the camera. It has to work at the first try.', date('now', '-7 days'), 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 minutes'), 'Claude (Marta)'),
  ('demo-kyc', 'demo', 'Screening against sanctions and PEP lists', 'building', 2, 'Compliance', 'C1',
   'The applicant''s name and date of birth checked against the sanctions lists and the politically exposed persons list before the account opens. A match stops the opening; what a partial match does is the open decision.',
   '', date('now', '-6 days'), 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-25 minutes'), 'Gemini (Tomás)'),

  ('demo-address', 'demo', 'Proof of address upload', 'next', 1, 'Identity', 'I3',
   'A utility bill or bank statement from the last three months, photographed or as a PDF; its name and address compared with the form.',
   '', date('now', '-6 days'), 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'), 'Lucía Pérez'),
  ('demo-terms', 'demo', 'Account terms and electronic signature', 'next', 2, 'Legal', 'L1',
   'The terms for the chosen account, read on the phone, and signed with a code sent by SMS; the signed PDF kept with the application and emailed to the applicant.',
   '', date('now', '-5 days'), 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'), 'Lucía Pérez'),
  ('demo-deposit', 'demo', 'First deposit by bank transfer', 'next', 3, 'Payments', 'P1',
   'The new account''s number shown with a button to copy it; the account is active when the first transfer arrives, and the applicant is told.',
   '', date('now', '-5 days'), 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'), 'Lucía Pérez'),

  ('demo-card', 'demo', 'Debit card ordered at the end', 'agreed', 1, 'Cards', 'P2',
   'A virtual card at once, for paying from the phone, and the plastic one posted to the address that was proved.',
   '', date('now', '-4 days'), 1,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days'), 'Lucía Pérez'),
  ('demo-welcome-mail', 'demo', 'Welcome email and push notification', 'agreed', 2, 'Messaging', 'M1',
   'When the account opens: an email with what to do first, and a notification that opens the app on the new account.',
   '', date('now', '-4 days'), 0,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days'), 'Lucía Pérez'),

  ('demo-joint', 'demo', 'Open a joint account', 'ideas', 1, 'App', '',
   'Two applicants, each verified on their own phone, joined into one account.',
   'Couples ask for this more than anything else.', date('now', '-3 days'), 0,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 days'), 'Lucía Pérez'),
  ('demo-resume', 'demo', 'Resume an application on another device', 'ideas', 2, 'App', '',
   'Started on the laptop, finished on the phone, where the camera is.', '', date('now', '-2 days'), 0,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), 'Marta Gómez'),
  ('demo-video', 'demo', 'A video call with an agent when the scan fails', 'ideas', 3, 'Identity', '',
   'After three failed scans, offer a person on a video call rather than a dead end.', '', date('now', '-1 days'), 0,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'), 'Claude (Marta)'),

  ('demo-minor', 'demo', 'Accounts for under-18s', 'parked', 1, 'Legal', '',
   'Parked until Legal says what a guardian has to sign, and in which countries.', '', date('now', '-8 days'), 0,
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-8 days'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days'), 'Lucía Pérez');

-- The queue: what the agents take next, in order - three cards and a task.
INSERT INTO queue (project, card, title, rank, added, added_by) VALUES
  ('demo', 'demo-address', '', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'), 'Lucía Pérez'),
  ('demo', 'demo-terms', '', 2, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'), 'Lucía Pérez'),
  ('demo', NULL, 'Load test the SMS sender at 50 codes a second', 3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-20 hours'), 'Tomás Ruiz'),
  ('demo', 'demo-deposit', '', 4, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'), 'Lucía Pérez');

-- Notes between people and their agents.
INSERT INTO notes (card, text, author, at, asks, agent) VALUES
  ('demo-welcome', 'Built with both account types and the comparison table. Screenshots of both themes attached in the review.', 'Claude (Marta)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days', '-2 hours'), 0, 1),
  ('demo-welcome', 'Looks right. Merged.', 'Marta Gómez', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days'), 0, 0),
  ('demo-welcome', 'Merged and moved to Done.', 'Claude (Marta)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-6 days', '+5 minutes'), 0, 1),
  ('demo-sms', 'The provider allows 40 codes a second on our plan. I added a queue so a burst waits instead of failing, and a task to load test it.', 'Gemini (Tomás)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days', '-3 hours'), 0, 1),
  ('demo-sms', 'Good. Done for now; the load test is in the queue.', 'Tomás Ruiz', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), 0, 0),
  ('demo-sms', 'Moved to Done; the load test is queued behind the proof of address.', 'Gemini (Tomás)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days', '+4 minutes'), 0, 1),
  ('demo-scan', 'Document reading works for the five test IDs. The selfie match fails for one applicant with glasses: the score is 0.71 against a threshold of 0.80.', 'Claude (Marta)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'), 0, 1),
  ('demo-scan', 'Ask the applicant to take the glasses off before the selfie, and keep the threshold. Compliance will not lower it.', 'Marta Gómez', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'), 0, 0),
  ('demo-scan', 'Added the hint on the selfie screen; the five pass now. Checking the two forged documents next.', 'Claude (Marta)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 minutes'), 0, 1),
  ('demo-kyc', 'Exact matches stop the opening and are logged for Compliance. For a partial match - same name, a different date of birth - I need to know whether to refuse or send to a person. Asked as a decision.', 'Gemini (Tomás)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-25 minutes'), 1, 1),
  ('demo-address', 'Which documents count as proof should come from Compliance''s list, not ours. @lucia can you attach it?', 'Tomás Ruiz', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'), 0, 0),
  ('demo-address', 'Noted: I will read the accepted documents from Compliance''s list once it is attached, rather than keep a list of my own.', 'Claude (Marta)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days', '+10 minutes'), 0, 1);

-- Decisions: two answered, and the one an agent is waiting on.
INSERT INTO decisions (project, card, question, options, answer, words, asked, asked_by, answered, answered_by) VALUES
  ('demo', 'demo-scan', 'Use the identity vendor''s SDK for the camera, or build our own camera screen?',
   '["The vendor''s SDK","Our own screen"]', 'The vendor''s SDK',
   'Their SDK already handles glare and blur. Our own screen later, if it holds us back.',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days'), 'Claude (Marta)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-7 days', '+1 hours'), 'Marta Gómez'),
  ('demo', 'demo-details', 'Keep an unfinished application for how long?',
   '["24 hours","7 days","30 days"]', '7 days',
   'A week, then it is deleted and the applicant is told. Nothing longer without consent.',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days'), 'Claude (Marta)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 days', '+3 hours'), 'Lucía Pérez'),
  ('demo', 'demo-kyc', 'A partial sanctions match - same name, a different date of birth: refuse the opening, or send it to a person to review?',
   '["Refuse","Send to manual review","Ask the applicant for a second document"]', NULL, '',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-25 minutes'), 'Gemini (Tomás)', NULL, NULL);

-- A discussion, being shaped into cards.
INSERT INTO discussions (project, title, idea, purpose, stage, summary, options, questions, created, author, updated) VALUES
  ('demo', 'How far does an applicant get before we check who they are?',
   'Today the identity check comes after the whole form. Most people who give up do it at the camera, after ten minutes of typing.',
   'Fewer people giving up halfway, without opening accounts we would have to close.',
   'shaping',
   'Two ways are on the table. Checking first is fastest to a refusal and loses nothing typed; checking last lets people see what they are getting first. The numbers from last month say the camera, not the form, is where people leave.',
   '[{"name":"Check identity first","plus":"Nobody types ten minutes and is then refused; forged documents stop at once","minus":"A camera before anything else feels like a lot to ask","recommended":true},{"name":"Check identity last, as now","plus":"People see the account they are opening before the camera","minus":"Half of those who leave do so after the form is done"}]',
   '["Can the vendor''s SDK run before the form, with no name to compare against yet?","Does Legal need the terms accepted before we read a document?"]',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), 'Lucía Pérez', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 minutes'));

INSERT INTO messages (discussion, text, author, at, agent)
  SELECT id, 'Today the identity check comes after the whole form. Most people who give up do it at the camera, after ten minutes of typing. Could we check first?', 'Lucía Pérez', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 days'), 0 FROM discussions WHERE project = 'demo';
INSERT INTO messages (discussion, text, author, at, agent)
  SELECT id, 'From last month''s funnel: 61% of those who left did so on the camera screen, 9% on the form. Checking first would move that loss earlier, before the typing, rather than remove it. I wrote both ways up as options.', 'Claude (Marta)', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 days'), 1 FROM discussions WHERE project = 'demo';
INSERT INTO messages (discussion, text, author, at, agent)
  SELECT id, 'First, I think. Two questions before we agree, written above.', 'Marta Gómez', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 minutes'), 0 FROM discussions WHERE project = 'demo';

-- What the agents are doing now: one at work, one waiting on the decision.
INSERT INTO doing (project, author, person, state, card, step, waiting, model, since, updated) VALUES
  ('demo', 'Claude (Marta)', NULL, 'working', 'demo-scan', 'checking the two forged documents are refused',
   '', 'Claude Opus 5.5', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 minutes')),
  ('demo', 'Gemini (Tomás)', NULL, 'waiting', 'demo-kyc', 'partial matches',
   'a decision: refuse or review a partial match', 'Gemini 3 Pro', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-25 minutes'));

-- Today's changes, as the feed shows them - and every step the agents said,
-- from which Live draws each one's day.
INSERT INTO changes (project, at, author, kind, card, data) VALUES
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-5 hours'), 'Gemini (Tomás)', 'now', NULL, '{"state":"working","step":"Load test the SMS sender at 50 codes a second"}'),
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 hours', '-20 minutes'), 'Gemini (Tomás)', 'now', 'demo-kyc', '{"state":"working","step":"loading the sanctions lists"}'),
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 hours', '-30 minutes'), 'Claude (Marta)', 'now', 'demo-welcome', '{"state":"working","step":"the comparison table in both themes"}'),
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours', '-40 minutes'), 'Claude (Marta)', 'now', NULL, '{"state":"idle"}'),
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'), 'Claude (Marta)', 'now', 'demo-scan', '{"state":"working","step":"reading the five test IDs"}'),
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours', '-50 minutes'), 'Gemini (Tomás)', 'now', 'demo-kyc', '{"state":"working","step":"exact matches stop the opening"}'),
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours', '-55 minutes'), 'Claude (Marta)', 'now', 'demo-scan', '{"state":"waiting","step":"the selfie threshold","waiting":"Marta: lower the match threshold for glasses?"}'),
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'), 'Claude (Marta)', 'now', 'demo-scan', '{"state":"working","step":"a hint to take glasses off before the selfie"}'),
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hours'), 'Claude (Marta)', 'now', 'demo-scan', '{"state":"working","step":"the five test applicants pass"}'),
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'), 'Claude (Marta)', 'queue.take', 'demo-scan', '{}'),
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-3 hours'), 'Claude (Marta)', 'note', 'demo-scan', '{"text":"Document reading works for the five test IDs."}'),
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-2 hours'), 'Marta Gómez', 'note', 'demo-scan', '{"text":"Ask the applicant to take the glasses off before the selfie."}'),
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-40 minutes'), 'Marta Gómez', 'discussion.message', NULL, '{"discussion":1}'),
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-25 minutes'), 'Gemini (Tomás)', 'decision.new', 'demo-kyc', '{"question":"A partial sanctions match: refuse, or send to a person?"}'),
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-25 minutes'), 'Gemini (Tomás)', 'now', 'demo-kyc', '{"state":"waiting","step":"partial matches","waiting":"a decision: refuse or review a partial match"}'),
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-12 minutes'), 'Claude (Marta)', 'note', 'demo-scan', '{"text":"The five pass now. Checking the two forged documents next."}'),
  ('demo', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-4 minutes'), 'Claude (Marta)', 'now', 'demo-scan', '{"state":"working","step":"checking the two forged documents are refused"}');
