/* ============================================================
   Cairn — guiding questions for the thankful journal.

   Five slots, five different questions, drawn from different
   corners of life so you don't write "my family" five times.
   The set rotates by day, so it's fresh but not random-feeling.
   ============================================================ */

const BANK = [
  /* people */
  ['Who showed you kindness recently, even in something small?',
   'Which person are you glad to have in your life today?',
   'Who has God used to teach you something this year?',
   'Whose voice did you hear this week that you needed to hear?',
   'Who prayed for you, or would if you asked?'],

  /* the ordinary */
  ['What small, ordinary thing made today easier?',
   'What did you eat, see, or hear today that you enjoyed?',
   'What do you have that you almost never notice?',
   'What went right today that you expected to go wrong?',
   'What is comfortable about where you are sitting right now?'],

  /* provision */
  ['What need was met this week, even quietly?',
   'What do you have today that you once prayed for?',
   'Where did you have enough when you were afraid you would not?',
   'What has God provided that you did not earn?',
   'What burden are you not carrying today?'],

  /* character of God */
  ['What is true about God that you are glad is true?',
   'Where did you see God at work this week, however small?',
   'What has God forgiven you for?',
   'What promise are you leaning on right now?',
   'What about Jesus are you thankful for today?'],

  /* growth and hard things */
  ['What hard thing are you grateful you went through?',
   'Where have you grown in a way you did not choose?',
   'What did you learn recently that you needed to learn?',
   'What are you glad you said no to?',
   'What are you thankful is behind you?'],
];

/** Five prompts for a given day — one from each category, rotating. */
export function promptsForDay(seed = Math.floor(Date.now() / 86400000)) {
  return BANK.map((group, i) => group[(seed + i * 3) % group.length]);
}

/** A different prompt from the same category — for the "another" link. */
export function rerollPrompt(slotIndex, current) {
  const group = BANK[slotIndex % BANK.length];
  const others = group.filter((p) => p !== current);
  return others[Math.floor(Math.random() * others.length)] ?? group[0];
}

/** Gentle openers for the free-form journal. */
export const OPEN_PROMPTS = [
  'What is on your mind today?',
  'What are you carrying right now?',
  'What do you want to say to God that you have not said out loud?',
  'What happened today that you want to remember?',
  'Where do you need help?',
  'What are you hoping for?',
];
