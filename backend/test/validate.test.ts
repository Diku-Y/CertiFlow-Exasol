import "./helpers";
import test from "node:test";
import assert from "node:assert/strict";
import * as v from "../src/utils/validate";
import { AppError } from "../src/utils/httpError";
import { maskAccount, roundMoney } from "../src/utils/ids";

const fails = (fn: () => unknown, rx?: RegExp) => assert.throws(fn, (e: any) => e instanceof AppError && e.status === 400 && (!rx || rx.test(e.message)));

test("money: positive, max 2 decimals, finite", () => {
    assert.equal(v.money(10.5), 10.5); assert.equal(v.money("99.99"), 99.99);
    for (const bad of [0, -5, NaN, Infinity, "abc", 1.005, undefined, 2e9]) fails(() => v.money(bad));
});
test("PIN rules reject weak PINs", () => {
    assert.equal(v.pin("482916"), "482916");
    for (const bad of ["111111", "123456", "654321", "12345", "abcdef", "1234567"]) fails(() => v.pin(bad));
});
test("password needs 8+ chars with letters and digits", () => {
    assert.equal(v.password("Customer@123"), "Customer@123");
    for (const bad of ["short1", "onlyletters", "12345678"]) fails(() => v.password(bad));
});
test("phone and email", () => {
    assert.equal(v.phone("+91 98400 12345"), "9840012345"); fails(() => v.phone("1234567890"));
    assert.equal(v.email("A@B.com"), "a@b.com"); fails(() => v.email("nope"));
});
test("regex escape prevents ReDoS / injection in search", () => { assert.equal(v.escapeRegex("a.*(b)"), "a\\.\\*\\(b\\)"); });
test("misc helpers", () => {
    assert.equal(maskAccount("123456789012"), "XXXX9012"); assert.equal(roundMoney(0.1 + 0.2), 0.3);
    assert.deepEqual(v.paging({ page: "3", limit: "500" }, 20, 100), { page: 3, limit: 100, skip: 200 });
    fails(() => v.parseDate("not-a-date", "From"));
});
