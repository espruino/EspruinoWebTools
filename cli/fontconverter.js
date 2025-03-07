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
       --shiftUp #  - shift all font glyphs up by the given amount
       --nudge      - automatically shift glyphs up or down to fit in the given font height
       --doubleSize - double the size of this font using a pixel doubling algorithm
       --doubleSize2  double the size of this font using a smooth pixel doubling algorithm
       --spaceWidth #
                    - set the size (in pixels) of the space(32) character
       --test "str" - Render the given string in the current font and print it to the console

       --ojs fn.js   - save the font as JS - only works for <1000 chars
       --oh  fn.h    - save the font as a C header file (uses data for each char including blank ones)
       --opbf fn.pbf - save a binary PBF file
       --opbff fn.pbff save a text PBFF file
       --opbfc NAME    - save a binary PBF file, but as a C file that can be included in Espruino
                       (jswrap_font_NAME.c/h are written)

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
  } else if (arg=="--shiftUp") {
    options.shiftUp = parseInt(process.argv[++i]);
  } else if (arg=="--nudge") {
    options.nudge = 1;
  } else if (arg=="--doubleSize") {
    options.doubleSize = 1;
  } else if (arg=="--doubleSize2") {
    options.doubleSize = 2;
  } else if (arg=="--spaceWidth") {
    options.spaceWidth = parseInt(process.argv[++i]);
  } else if (arg=="--test") {
    if (!options.tests) options.tests=[];
    options.tests.push(process.argv[++i]);
  } else if (arg=="--ojs") {
    options.ojs = process.argv[++i];
  } else if (arg=="--oh") {
    options.oh = process.argv[++i];
  } else if (arg=="--opbf") {
    options.opbf = process.argv[++i];
  } else if (arg=="--opbff") {
    options.opbff = process.argv[++i];
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
if (options.shiftUp)
  font.shiftUp(options.shiftUp);
if (options.nudge)
  font.nudge();
if (options.doubleSize)
  font.doubleSize(options.doubleSize == 2);
if (options.spaceWidth) {
  var space = font.glyphs[32];
  if (!space) space = font.glyphs[32] = font.getGlyph(32, (x,y) => 0)
  space.width = options.spaceWidth;
  space.xEnd = options.spaceWidth-1;
  space.advance = options.spaceWidth;
}

if (options.debug) {
  font.debugChars();
  font.debugPixelsUsed();
}
if (options.tests)
  options.tests.forEach(test => font.printString(test));
if (options.ojs)
  require("fs").writeFileSync(options.ojs, Buffer.from(font.getJS()))
if (options.oh)
  require("fs").writeFileSync(options.oh, Buffer.from(font.getHeaderFile()))
if (options.opbf)
  require("fs").writeFileSync(options.opbf, Buffer.from(font.getPBF()))
if (options.opbff)
  require("fs").writeFileSync(options.opbff, Buffer.from(font.getPBFF()))
if (options.opbfc)
  font.getPBFAsC({
    name:options.opbfc,
    filename:"jswrap_font_"+options.opbfc,
    createdBy:"EspruinoWebTools/cli/fontconverter.js "+process.argv.slice(2).join(" ")
  });
