#!/usr/bin/node

var fontconverter = require("../fontconverter.js");
var RANGES = fontconverter.getRanges();

var fontInfo = {};
var options = {};

// Scan Args
for (var i=2;i<process.argv.length;i++) {
  var arg = process.argv[i];
  console.log(arg);
  if (arg=="--help") {
    console.log(`Espruino Font Converter CLI (BETA)
-------------------------------

USAGE:

cli/fontconverter.js sourceFile
       --help       - show this message
       --debug      - print debug info for loaded font
       --height #   - set the height of the font
       --range ${Object.keys(RANGES).join("|")} (default=ASCII)
                    - which range of characters should be included

       --ojs fn.js   - save the font as JS - only works for <1000 chars
       --oh  fn.h    - save the font as a C header file (uses data for each char including blank ones)
       --opbf fn.pbf - save a binary PBF file
                      //  eg. require("fs").writeFileSync("font.pbf", Buffer.from(font.getPBF()))
       --opbfc fn    - save a binary PBF file, but as a C file that can be included in Espruino
                       (fn.c and fn.h are written)

Input font can be:
      ...json       -  font made using https://www.pentacom.jp/pentacom/bitfontmaker2/
      ...pbff       -  pebble font format (text mode)
      ...png        -  8x8 font map
      ...bdf        -  Linux font format
      `);
  } else if (arg=="--debug") {
    options.debug = true;
  } else if (arg=="--height") {
    fontInfo.height = 0|process.argv[++i];
  } else if (arg=="--range") {
    options.rangeId = process.argv[++i];
    var range = RANGES[options.rangeId];
    if (!range) throw new Error(`Range ID ${options.rangeId} not found`);
    fontInfo.range = range.range;
  } else if (arg=="--ojs") {
    options.ojs = process.argv[++i];
  } else if (arg=="--oh") {
    options.oh = process.argv[++i];
  } else if (arg=="--opbf") {
    options.opbf = process.argv[++i];
  } else if (arg=="--opbfc") {
    options.opbfc = process.argv[++i];
  } else if (arg.startsWith("-")) {
    throw new Error(`Unknown argument '${arg}'`);
  } else {
    if (fontInfo.fn) throw new Error(`Source file already specified (${fontInfo.fn})`);
    fontInfo.fn = arg;
  }
}


// Checks
if (!fontInfo.fn) throw new Error("No font source file specified");
// Do stuff
var font = fontconverter.load(fontInfo);
if (options.debug) {
  font.debugChars();
  font.debugPixelsUsed();
}
if (options.ojs)
  require("fs").writeFileSync(options.ojs, Buffer.from(font.getJS()))
if (options.oh)
  require("fs").writeFileSync(options.oh, Buffer.from(font.getHeaderFile()))
if (options.opbf)
  require("fs").writeFileSync(options.opbf, Buffer.from(font.getPBF()))
if (options.opbfc)
  font.getPBFAsC({filename:options.opbfc});
