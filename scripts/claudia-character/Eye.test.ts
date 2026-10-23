import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Eye, eyeGeometry, type EyeProps } from "./Eye.js";

const base: EyeProps = {
  id: "test-left", x: 270, y: 230, gazeX: 4, gazeY: -1,
  blink: 0, openness: 1, squint: 0, browLift: 0, browTilt: 0,
};
const render = (changes: Partial<EyeProps> = {}) => renderToStaticMarkup(
  React.createElement("svg", {}, React.createElement(Eye, { ...base, ...changes })),
);

test("the eyelids close onto one seam without inverting the aperture", () => {
  for (const openness of [.78, 1, 1.16]) {
    for (const squint of [0, .5, 1]) {
      let previous = Infinity;
      for (let step = 0; step <= 20; step++) {
        const geometry = eyeGeometry(step / 20, openness, squint);
        assert.ok(Number.isFinite(geometry.aperture) && geometry.aperture >= 0);
        assert.ok(geometry.aperture <= previous, "Closing lids must not reopen or cross");
        previous = geometry.aperture;
      }
      const closed = eyeGeometry(1, openness, squint);
      assert.equal(closed.upperLid, closed.lowerLid);
      assert.equal(closed.aperture, 0);
      assert.equal(closed.closed, true);
    }
  }
  const open = eyeGeometry(0, 1, 0), closed = eyeGeometry(1, 1, 0);
  assert.ok(closed.upperMidY - open.upperMidY > open.lowerMidY - closed.lowerMidY,
    "The upper lid should do most of the work during a blink");
});

test("changing expression clips a fixed iris and pupil instead of scaling the eyeball", () => {
  const open = render();
  const halfClosed = render({ blink: .5, openness: .9, squint: .5 });
  const ellipses = (markup: string) => [...markup.matchAll(/<ellipse\b[^>]*>/gu)].map((match) => match[0]);
  assert.equal(ellipses(open).length, 2, "Both iris and pupil should render");
  assert.deepEqual(ellipses(halfClosed), ellipses(open), "Lid movement must not squash the iris or pupil");
  for (const markup of [open, halfClosed]) {
    assert.match(markup, /<clipPath id="eye-aperture-test-left" clipPathUnits="userSpaceOnUse">/u);
    assert.match(markup, /<g clip-path="url\(#eye-aperture-test-left\)">/u);
    assert.doesNotMatch(markup, /scale\(/u);
  }
  assert.notEqual(eyeGeometry(0, 1, 0).aperturePath, eyeGeometry(.5, .9, .5).aperturePath);
});

test("full blink contact hides eye white, iris and glint and uses a separate clip for each eye", () => {
  const closed = render({ blink: 1 });
  assert.doesNotMatch(closed, /<(?:ellipse|circle)\b/u, "No eyeball or glint may show through the closed seam");
  assert.doesNotMatch(closed, /<g clip-path=/u, "The eye-white group must also disappear at contact");
  assert.match(closed, /opacity="0"/u, "The coincident lower seam must not add a second dark stroke");
  const other = render({ id: "test-right" });
  assert.match(other, /clip-path="url\(#eye-aperture-test-right\)"/u);
  assert.doesNotMatch(other, /eye-aperture-test-left/u);
});
