const regex = /(?:(?:fol\.?|f\.?)\s*(\d+(?:r|v|recto|verso)?)|(?<!\w)(\d+(?:r|v|recto|verso)))(?!\w)/i;

const tests = [
  "14r", "14v", "14recto", "14verso", "f. 14", "fol. 14", "fol 14r", "f 14v", "14", "f.14"
];

tests.forEach(t => {
  const m = regex.exec(t);
  if (m) {
    console.log(t, "->", m[1] || m[2]);
  } else {
    console.log(t, "-> NO MATCH");
  }
});
