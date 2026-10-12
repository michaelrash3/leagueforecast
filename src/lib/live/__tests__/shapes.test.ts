import { describe, expect, it } from "vitest";
import { fits, type Shape } from "../shapes";

/*
 * The shape a larger answer from the server must have before a card draws it (`shapes.ts`): each
 * kind of value as strict as the card needs it, a field it names always of its kind, and a field it
 * does not name let through for a newer server to say.
 */

const each = (shape: Shape, values: unknown[]) => values.map((value) => fits(value, shape));

describe("a value of one kind", () => {
  it("is a string, an id with something in it, or a number that is a number", () => {
    expect(each("string", ["", "x", 1, null, undefined])).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(each("id", ["x", "", 1])).toEqual([true, false, false]);
    expect(each("number", [0, -1.5, NaN, Infinity, "1"])).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("is a count only whole and none or more, and a flag only true or false", () => {
    expect(each("count", [0, 7, -1, 1.5, 2 ** 53, "3"])).toEqual([
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    expect(each("boolean", [true, false, 0, "true"])).toEqual([true, true, false, false]);
  });

  it("is one of the words named, and no other", () => {
    const shape: Shape = { oneOf: ["strong", "likely"] };
    expect(each(shape, ["strong", "likely", "Strong", "", 1])).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
});

describe("a value that may be missing", () => {
  it("is missing or of its kind when optional, and null or of its kind when nullable", () => {
    expect(each({ optional: "count" }, [undefined, 3, null, -1])).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(each({ nullable: "count" }, [null, 3, undefined, "3"])).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

describe("a value made of others", () => {
  it("is a list of its items, every one of them", () => {
    const shape: Shape = { list: "id" };
    expect(each(shape, [[], ["a", "b"], ["a", ""], "a", { 0: "a", length: 1 }])).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it("is a record with every field it names, of its kind, and any it does not", () => {
    const shape: Shape = { record: { id: "id", note: { optional: "string" } } };
    expect(fits({ id: "a" }, shape)).toBe(true);
    expect(fits({ id: "a", note: "x", newer: [1, 2] }, shape)).toBe(true);
    expect(fits({ id: "a", note: 1 }, shape)).toBe(false);
    expect(fits({ note: "x" }, shape)).toBe(false);
    expect(each(shape, [null, [], "a", 1])).toEqual([false, false, false, false]);
  });

  it("reads only a record's own fields, never one every object answers to", () => {
    // `{}.toString` is a function, which no field of this shape could be.
    const words: Shape = { optional: "string" };
    expect(fits({}, { record: { toString: words } })).toBe(true);
    // A field inherited is not the record's own, so it is missing.
    expect(fits(Object.create({ id: "a" }) as object, { record: { id: "id" } })).toBe(false);
  });

  it("is a dictionary of any keys, every value of its shape", () => {
    const shape: Shape = { dictionary: { record: { name: "string" } } };
    expect(fits({}, shape)).toBe(true);
    expect(fits({ A: { name: "Club A" }, B: { name: "Club B" } }, shape)).toBe(true);
    expect(fits({ A: { name: "Club A" }, B: { name: 2 } }, shape)).toBe(false);
    expect(fits([{ name: "Club A" }], shape)).toBe(false);
  });
});
