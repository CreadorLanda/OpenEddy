import { describe, expect, it } from "vitest";
import { expressionForTag } from "./eddy";

// O rosto segue a marcação de áudio que o Eddy fala. Se uma marcação deixar de
// ter expressão, o rosto trava na anterior durante a fala inteira.

describe("audio tag to face", () => {
  it("every tag the prompt offers moves the face", () => {
    const expected: Record<string, string> = {
      "[sighs]": "neutral",
      "[laughs]": "laughing",
      "[scoffs]": "annoyed",
      "[sarcastic]": "smug",
      "[dramatically]": "surprised",
      "[annoyed]": "annoyed",
      "[excited]": "laughing",
      "[mischievously]": "mischievous",
      "[whispers]": "smug",
      "[gasps]": "surprised",
      "[clears throat]": "neutral",
      "[proudly]": "proud",
      "[angry]": "angry",
      "[sad]": "sad",
      "[crying]": "crying",
      "[winks]": "wink",
      "[skeptical]": "skeptical",
      "[disgusted]": "disgusted",
    };
    for (const [tag, face] of Object.entries(expected)) {
      expect(expressionForTag(tag), tag).toBe(face);
    }
  });

  it("is read one tag at a time, as the speech arrives", () => {
    // Cada marcação é avaliada sozinha (é o que a fila faz, pedaço a pedaço):
    // a face troca no instante em que aquela marcação começa a falar.
    expect(expressionForTag("[sighs]")).toBe("neutral");
    expect(expressionForTag("[crying]")).toBe("crying");
  });

  it("takes the tag whatever its case and its spaces", () => {
    expect(expressionForTag("  Sighs ")).toBe("neutral");
    expect(expressionForTag("Mischievously")).toBe("mischievous");
  });

  it("a tag nobody knows leaves the face alone", () => {
    expect(expressionForTag("[dances]")).toBeNull();
    expect(expressionForTag("")).toBeNull();
  });
});