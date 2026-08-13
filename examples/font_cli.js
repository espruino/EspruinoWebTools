#!/usr/bin/node
// Simple example showing the font converter running under node.js

let fontconverter = require("../fontconverter.js");
//
console.log("Available char code ranges\n  - "+Object.keys(fontconverter.getRanges()).join("\n  - "));
// load a unifont PNG file
let font = fontconverter.load({
  fn : "unifont-15.1.04.png", // from https://unifoundry.com/unifont/index.html
  mapWidth : 256, mapHeight : 256,
  mapOffsetX : 32, mapOffsetY : 64,
  height : 16, // actual used height of font map
  // range : fontconverter.getRanges().ASCII/etc
  //range : [ {min : 32, max : 127 } ],
  //range : [ {min : 0x4E00, max : 0x9FFF } ]
  //range : [ {min : 0x8000, max : 0x9FFF } ]
  range : [ { min : 32, max : 0xD7FF } ] // all inc korean
});
font.removeUnifontPlaceholders();
console.log(Object.keys(font.__proto__));
font.debugChars();
require("fs").writeFileSync("font.pbf", Buffer.from(font.getPBF()));
