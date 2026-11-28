// Checks the paste-to-fill formatter (src/lib/notes-parser.ts) against notes
// written the ways members actually write them. Run: npm run test:notes
import assert from "node:assert/strict";
import { findDate, findHours, parseNotes } from "../src/lib/notes-parser.ts";

const TODAY = "2026-11-27";
let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`pass  ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL  ${name}\n      ${String(error.message).split("\n").join("\n      ")}`);
  }
}

const hours = (text, today = TODAY) => parseNotes(text, "hours", today).rows.map((row) => [row.date, row.text, row.hours]);
const contributions = (text) => parseNotes(text, "contribution", TODAY).rows.map((row) => [row.date, row.text, row.details]);

check("a bulleted log with dates and hours in different styles", () => {
  const rows = hours(`Volunteer Log - Fall 2026
- Oct 12: Taught Scratch basics to 5th graders at the library (2 hrs)
- 10/19/2026 - Robotics club mentoring, 1.5 hours
- Saturday, October 26th — Helped set up the STEM fair booth — 3 hours
Total: 6.5 hours`);
  assert.deepEqual(rows, [
    ["2026-10-12", "Taught Scratch basics to 5th graders at the library", "2"],
    ["2026-10-19", "Robotics club mentoring", "1.5"],
    ["2026-10-26", "Helped set up the STEM fair booth", "3"],
  ]);
});

check("paragraphs under a date line, hours on their own line", () => {
  const rows = hours(`October 5, 2026
Ran the coding workshop for middle schoolers.
Prepared slides and helped students debug.
Time: 2 hours 30 minutes

November 2
Wrote the newsletter article about our hackathon (45 min)`);
  assert.deepEqual(rows, [
    ["2026-10-05", "Ran the coding workshop for middle schoolers. Prepared slides and helped students debug.", "2.5"],
    ["2026-11-02", "Wrote the newsletter article about our hackathon", "0.75"],
  ]);
});

check("a table copied from Google Sheets (tabs), header and total skipped", () => {
  const rows = hours("Date\tActivity\tHours\n9/14/2026\tCleaned up the makerspace\t1\n9/21/2026\tTutoring\t2.5\nTotal\t\t3.5");
  assert.deepEqual(rows, [
    ["2026-09-14", "Cleaned up the makerspace", "1"],
    ["2026-09-21", "Tutoring", "2.5"],
  ]);
});

check("a Markdown table", () => {
  const rows = hours("| Date | What I did | Hours |\n|---|---|---|\n| Sep 3 | Set up laptops | 2 |\n| Sep 10 | Taught HTML | 1.25 |");
  assert.deepEqual(rows, [
    ["2026-09-03", "Set up laptops", "2"],
    ["2026-09-10", "Taught HTML", "1.25"],
  ]);
});

check("hours are never guessed: a range or a missing number stays blank", () => {
  const rows = hours("Oct 3 - Robotics practice, 1-2 hours\nOct 4 - Cleaned the lab");
  assert.deepEqual(rows, [
    ["2026-10-03", "Robotics practice", ""],
    ["2026-10-04", "Cleaned the lab", ""],
  ]);
});

check("fractions of an hour are hours, not dates", () => {
  const rows = hours("Nov 1 - Workshop prep, 1/2 hour\n11/8 – Mentoring 1 1/2 hrs\nNov 9: Food drive for half an hour");
  assert.deepEqual(rows, [
    ["2026-11-01", "Workshop prep", "0.5"],
    ["2026-11-08", "Mentoring", "1.5"],
    ["2026-11-09", "Food drive", "0.5"],
  ]);
});

check("words for hours, and the leftover 'for' is tidied", () => {
  assert.deepEqual(hours("Oct 4: Volunteered at the food bank for two hours"), [["2026-10-04", "Volunteered at the food bank", "2"]]);
});

check("hours in the middle of a sentence keep the sentence as written", () => {
  assert.deepEqual(hours("10/2 Spent 3 hours building the club website"), [["2026-10-02", "Spent 3 hours building the club website", "3"]]);
});

check("a date with no year is the most recent one", () => {
  assert.equal(findDate("Dec 15 – Holiday drive", "2026-11-27").iso, "2026-12-15");
  assert.equal(findDate("Dec 15 – Holiday drive", "2026-01-05").iso, "2025-12-15");
  assert.equal(findDate("Jan 10 kickoff", "2026-11-27").iso, "2026-01-10");
  assert.equal(findDate("Feb 30 nothing", TODAY), null);
});

check("other date styles", () => {
  assert.equal(findDate("2026-09-01 orientation", TODAY).iso, "2026-09-01");
  assert.equal(findDate("12 October 2025 event", TODAY).iso, "2025-10-12");
  assert.equal(findDate("the 3rd of Nov", TODAY).iso, "2026-11-03");
  assert.equal(findDate("Sept. 9th, 2026", TODAY).iso, "2026-09-09");
  assert.equal(findDate("10/12/25", TODAY).iso, "2025-10-12");
  assert.equal(findDate("We may 3D print it", TODAY), null);
});

check("hour styles", () => {
  assert.equal(findHours("2h 15m").hours, 2.25);
  assert.equal(findHours("Hours: 4").hours, 4);
  assert.equal(findHours("90 minutes").hours, 1.5);
  assert.equal(findHours("20 mins").hours, 0.33);
  assert.equal(findHours("an hour").hours, 1);
  assert.equal(findHours("taught 3 high schoolers"), null);
  assert.equal(findHours("met 5 members"), null);
});

check("notes without dates: each list item becomes a row with a blank date", () => {
  const rows = contributions("- Designed the club logo\n- Helped write the grant application to the school board. It took several weeks of edits.");
  assert.deepEqual(rows, [
    ["", "Designed the club logo", ""],
    [
      "",
      "Helped write the grant application to the school board",
      "Helped write the grant application to the school board. It took several weeks of edits.",
    ],
  ]);
});

check("a contribution keeps its details and its hours as written", () => {
  const rows = contributions("Oct 12 - Led the Scratch workshop (2 hrs). We had 14 students and I taught loops and events.\nAlso made a handout.");
  assert.deepEqual(rows, [
    [
      "2026-10-12",
      "Led the Scratch workshop (2 hrs)",
      "Led the Scratch workshop (2 hrs). We had 14 students and I taught loops and events.\nAlso made a handout.",
    ],
  ]);
});

check("name, total, and signature lines are not activities", () => {
  const rows = hours("Name: Ava Patel\nChapter: SB Chapter\nOct 1 - Setup, 1 hr\nSupervisor Signature: ____\nTotal hours 1");
  assert.deepEqual(rows, [["2026-10-01", "Setup", "1"]]);
});

check("empty or meaningless text gives no rows", () => {
  assert.deepEqual(parseNotes("", "hours", TODAY).rows, []);
  assert.deepEqual(parseNotes("   \n\n  ", "hours", TODAY).rows, []);
});

console.log(`\n${passed} passed, ${failed} failed.`);
if (failed) process.exit(1);
