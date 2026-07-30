import { describe, it } from "node:test";
import { deepEqual } from "node:assert";
import { parseImports } from "../src/imports.js";
describe("parseImports", () => {
    it("parses ESM default import", () => {
        const result = parseImports("import x from './y';", "file.ts");
        deepEqual(result, ["./y"]);
    });
    it("parses ESM named import", () => {
        const result = parseImports("import { a, b } from './x';", "file.ts");
        deepEqual(result, ["./x"]);
    });
    it("parses ESM package import", () => {
        const result = parseImports("import lodash from 'lodash';", "file.ts");
        deepEqual(result, ["lodash"]);
    });
    it("parses CommonJS require", () => {
        const result = parseImports("const x = require('./y');", "file.ts");
        deepEqual(result, ["./y"]);
    });
    it("parses Python from-import", () => {
        const result = parseImports("from os import path", "file.py");
        deepEqual(result, ["os"]);
    });
    it("parses Python direct import", () => {
        const result = parseImports("import numpy", "file.py");
        deepEqual(result, ["numpy"]);
    });
    it("returns empty for empty file", () => {
        const result = parseImports("", "file.ts");
        deepEqual(result, []);
    });
    it("deduplicates imports", () => {
        const result = parseImports("import x from './y';\nimport z from './y';", "file.ts");
        deepEqual(result, ["./y"]);
    });
});
