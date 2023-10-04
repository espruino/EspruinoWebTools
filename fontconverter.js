/* Copyright 2023 Gordon Williams, gw@pur3.co.uk
   https://github.com/espruino/EspruinoWebTools/fontconverter.js

  Bitmap font creator for Espruino Graphics custom fonts
*/
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
      // AMD. Register as an anonymous module.
      define(['b'], factory);
  } else if (typeof module === 'object' && module.exports) {
      // Node. Does not work with strict CommonJS, but
      // only CommonJS-like environments that support module.exports,
      // like Node.
      module.exports = factory(require('b'));
  } else {
      // Browser globals (root is window)
      root.fontconverter = factory(root.heatshrink);
  }
}(typeof self !== 'undefined' ? self : this, function(heatshrink) {

  function bitsToBytes(bits, bpp) {
    var bytes = [];
    if (bpp==1) {
      for (var i=0;i<bits.length;i+=8) {
        var byte = 0;
        for (var b=0;b<8;b++)
          byte |= (bits[i+b]) << (7-b);
        bytes.push(byte);
      }
    } else if (bpp==2) {
      for (var i=0;i<bits.length;i+=4) {
        var byte = 0;
        for (var b=0;b<4;b++)
          byte |= bits[i+b] << (6-b*2);
        bytes.push(byte);
      }
    } else throw "unknown bpp";
    return bytes;
  }

function Font(info) {
  this.name = info.name;
  this.id = this.name ? this.name.replace(/[^A-Za-z0-9]/g,"") : "Unknown";
  this.fn = info.fn;
  this.height = info.height;
  this.bpp = info.bpp||1;
  this.firstChar = (info.firstChar!==undefined) ? info.firstChar : 32;
  this.maxChars = info.maxChars || (256-this.firstChar);
  this.lastChar = this.firstChar + this.maxChars - 1;
  this.fixedWidth = !!info.fixedWidth;
  this.glyphPadX = 1; // padding at the end of glyphs (needed for old-style JS fonts)
  this.glyphs = [];
  // set up later:
  // fmWidth  - max width of any character (we scan this area when writing fonts, even if we crop down later)
  // fmHeight - max height of any character (we scan this area when writing fonts, even if we crop down later)
}

function FontGlyph(font, ch, getPixel) {
  this.font = font;
  this.ch = ch;
  this.getPixel = getPixel;
  // set up later:
  //
}

// Populate the `glyphs` array with a range of glyphs
Font.prototype.generateGlyphs = function(getCharPixel, firstChar, lastChar) {
  for (var ch=this.firstChar; ch<=this.lastChar; ch++)
    this.glyphs[ch] = this.getGlyph(ch, (x,y) => getCharPixel(ch,x,y));
};

// Append the bits to define this glyph to the array 'bits'
FontGlyph.prototype.appendBits = function(bits, info) {
  // glyphVertical : are glyphs scanned out vertically or horizontally?
  if (info.glyphVertical) {
    for (var x=this.xStart;x<=this.xEnd;x++) {
      for (var y=this.yStart;y<=this.yEnd;y++) {
        bits.push(this.getPixel(x,y));
      }
    }
  } else {
    for (var y=this.yStart;y<=this.yEnd;y++) {
      for (var x=this.xStart;x<=this.xEnd;x++) {
        bits.push(this.getPixel(x,y));
      }
    }
  }
 }

 FontGlyph.prototype.getImageData = function() {
   var bpp = this.font.bpp;
   var img = new ImageData(this.xEnd+1, this.yEnd+1);
   for (var y=0;y<=this.yEnd;y++)
     for (var x=0;x<=this.xEnd;x++) {
      var n = (x + y*img.width)*4;
      var c = this.getPixel(x,y);
      var prevCol = 255 - ((bpp==1) ? c*255 : (c << (8-bpp)));
      img.data[n] = img.data[n+1] = img.data[n+2] = prevCol;
      if (x>=this.xStart && y>=this.yStart) {
        img.data[n] = 128;
        img.data[n+3] = 255;
      }
     }
   return img;
 };

 FontGlyph.prototype.debug = function() {
  var map = ".#";//"░█";
  if (this.font.bpp==2) map = "░▒▓█";
  var debugText = [];
  for (var y=0;y<this.font.fmHeight;y++) debugText.push("");
  for (var x=this.xStart;x<=this.xEnd;x++) {
    for (var y=0;y<this.font.fmHeight;y++) {
      var col = this.getPixel(x,y);
      debugText[y] += (y>=this.yStart && y<=this.yEnd) ? map[col] : ".";
    }
  }
  console.log("charcode ", this.ch);
  console.log(debugText.join("\n"));
};

 Font.prototype.getGlyph = function(ch, getPixel) {
  // work out widths
  var glyph = new FontGlyph(this, ch, getPixel);
  var xStart, xEnd;
  var yStart = this.fmHeight, yEnd = 0;

  if (this.fixedWidth) {
    xStart = 0;
    xEnd = this.fmWidth-1;
  } else {
    xStart = this.fmWidth;
    xEnd = 0;
    for (var x=0;x<this.fmWidth;x++) {
      for (var y=0;y<this.fmHeight;y++) {
        var set = glyph.getPixel(x,y);
        if (set) {
          // check X max value
          if (x<xStart) xStart = x;
          xEnd = x;
          // check Y max/min
          if (y<yStart) yStart = y;
          if (y>yEnd) yEnd = y;
        }
      }

    }
    if (xStart>xEnd) {
      xStart=0;
      xEnd = this.fmWidth >> 1; // treat spaces as half-width
    } else if (xEnd<this.fmWidth-1)
      xEnd += this.glyphPadX; // if not full width, add a space after
  }
  glyph.width = xEnd+1-xStart;
  glyph.xStart = xStart;
  glyph.xEnd = xEnd;
  glyph.advance = glyph.width;
  if (!this.glyphPadX) glyph.advance++; // hack - add once space of padding
  glyph.yStart = yStart;
  glyph.yEnd = yEnd;
  glyph.height = yEnd+1-yStart;

  return glyph;
};

// Load a 16x16 charmap file
function loadPNG(fontInfo) {
  fontInfo = new Font(fontInfo);
  var PNG = require("pngjs").PNG;
  var png = PNG.sync.read(require("fs").readFileSync(fontInfo.fn));

  console.log(`Font map is ${png.width}x${png.height}`);
  fontInfo.fmWidth = png.width>>4;
  fontInfo.fmHeight = png.height>>4;
  console.log(`Font map char is ${fontInfo.fmWidth}x${fontInfo.fmHeight}`);

  function getPngPixel(x,y) {
    var o = (x + (y*png.width))*4;
    var c = png.data.readInt32LE(o);
    var a = (c>>24)&255;
    var b = (c>>16)&255;;
    var g = (c>>8)&255;
    var r = c&255;
    if (a<128) return 0; // no alpha
    var avr = (r+g+b)/3;
    if (fontInfo.bpp==1) return 1-(avr>>7);
    if (fontInfo.bpp==2) return 3-(avr>>6);
    throw new Error("Unknown bpp");
    //console.log(x,y,c.toString(16), a,r,g,b,"=>",(a>128) && ((r+g+b)<384));
  }

  fontInfo.generateGlyphs(function(ch,x,y) {
    var chx = ch&15;
    var chy = ch>>4;
    var py = chy*fontInfo.fmHeight + y;
    if (py>=png.height) return false;
    return getPngPixel(chx*this.fmWidth + x, py);
  }, fontInfo.firstChar, fontInfo.lastChar);
  return fontInfo;
}

function loadJSON(fontInfo) {
  fontInfo = new Font(fontInfo);
  // format used by https://www.pentacom.jp/pentacom/bitfontmaker2/editfont.php import/export
  var font = JSON.parse(require("fs").readFileSync(fontInfo.fn).toString());
  fontInfo.fmWidth = 16;
  fontInfo.fmHeight = 16;

  fontInfo.generateGlyphs(function(ch,x,y) {
    if (!font[ch]) return 0;
    return (((font[ch][y] >> x) & 1)!=0) ? 1 : 0;
  }, fontInfo.firstChar, fontInfo.lastChar);
  return fontInfo;
}

function loadPBFF(fontInfo) {
  // format used by https://github.com/pebble-dev/renaissance/tree/master/files
  fontInfo = new Font(fontInfo);
  fontInfo.fmWidth = 0;
  fontInfo.fmHeight = fontInfo.height;
  fontInfo.glyphPadX = 0;
  var current = {
    idx : 0,
    bmp : []
  };
  var font = [];
  require("fs").readFileSync(fontInfo.fn).toString().split("\n").forEach(l => {
    if (l.startsWith("version")) {
    } else if (l.startsWith("fallback")) {
    } else if (l.startsWith("line-height")) {
    } else if (l.startsWith("glyph")) {
      current = {};
      current.idx = parseInt(l.trim().split(" ")[1]);
      current.bmp = [];
      font[current.idx] = current;
    } else if (l.trim().startsWith("-")) {
      // font line start/end
      if (l=="-") {
        //console.log(current); // end of glyph
      } else {
        var verticalOffset = parseInt(l.trim().split(" ")[1]);
        while (verticalOffset--) current.bmp.push("");
      }
    } else if (l.startsWith(" ") || l.startsWith("#") || l=="") {
      current.bmp.push(l);
      if (l.length > fontInfo.fmWidth) fontInfo.fmWidth = l.length;
      if (current.bmp.length > fontInfo.fmHeight) {
        console.log(current.idx+" bump height to "+current.bmp.length);
        fontInfo.fmHeight = current.bmp.length;
      }
    } else if (l!="") console.log(`Unknown line '${l}'`);
  });

  fontInfo.generateGlyphs(function(ch,x,y) {
    if (!font[ch]) return 0;
    return (font[ch].bmp[y] && font[ch].bmp[y][x]=='#') ? 1 : 0;
  }, fontInfo.firstChar, fontInfo.lastChar);
  return fontInfo;
}

function load(fontInfo) {
  if (fontInfo.fn && fontInfo.fn.endsWith("png")) return loadPNG(fontInfo);
  else if (fontInfo.fn && fontInfo.fn.endsWith("json")) return loadJSON(fontInfo);
  else if (fontInfo.fn && fontInfo.fn.endsWith("pbff")) return loadPBFF(fontInfo);
  else throw new Error("Unknown font type");
}



Font.prototype.debugPixelsUsed = function() {
  var pixelsUsedInRow = new Array(this.height);
  pixelsUsedInRow.fill(0);
  Object.keys(this.glyphs).forEach(ch => {
    var glyph = this.glyphs[ch];
    for (var x=glyph.xStart;x<=glyph.xEnd;x++) {
      for (var y=0;y<this.height;y++) {
        var col = glyph.getPixel(x,y);
        if (col) pixelsUsedInRow[y]++;
      }
    }
  });
  console.log("Pixels used in rows:", JSON.stringify(pixelsUsedInRow,null,2));
};

Font.prototype.debugChars = function() {
  var map = "░█";
  if (this.bpp==2) map = "░▒▓█";
  Object.keys(this.glyphs).forEach(ch => {
    this.glyphs[ch].debug();
    console.log();
  });
};

// Outputs as JavaScript for a custom font
Font.prototype.getJS = function(options) {
  // options.compressed
  options = options||{};
  this.glyphPadX = 1;
  var charMin = Object.keys(this.glyphs)[0];
  // stats
  var minY = this.height;
  var maxY = 0;
  // get an array of bits
  var bits = [];
  var charGlyphs = [];
  Object.keys(this.glyphs).forEach(ch => {
    var glyph = this.glyphs[ch];
    if (glyph.yEnd > maxY) maxY = glyph.yEnd;
    if (glyph.yStart < minY) minY = glyph.yStart;
  });
  Object.keys(this.glyphs).forEach(ch => {
    var glyph = this.glyphs[ch];
    glyph.xStart = 0; // all glyphs have to start at 0 now
    glyph.yStart = 0;
    glyph.xEnd = glyph.width-1;
    glyph.yEnd = this.height-1;
    glyph.height = this.height;
    glyph.appendBits(bits, {glyphVertical:true});
  });
  // compact array
  var fontData = bitsToBytes(bits, this.bpp);
  // convert width array - widthBytes
  var fontWidths = [];
  Object.keys(this.glyphs).forEach(ch => {
    fontWidths[ch] = this.glyphs[ch].width;
  });
  fontWidths = fontWidths.slice(charMin); // don't include chars before we're outputting
  var fixedWidth = fontWidths.every(w=>w==fontWidths[0]);

  var encodedFont;
  if (options.compressed) {
    const fontArray = new Uint8Array(fontData);
    const compressedFont = String.fromCharCode.apply(null, heatshrink.compress(fontArray));
    encodedFont =
      "E.toString(require('heatshrink').decompress(atob('" +
      btoa(compressedFont) +
      "')))";
  } else {
    encodedFont = "atob('" + btoa(String.fromCharCode.apply(null, fontData)) + "')";
  }

/*  return `
var font = atob("${require('btoa')(bytes)}");
var widths = atob("${require('btoa')(widthBytes)}");
g.setFontCustom(font, ${this.firstChar}, widths, ${this.height} | ${this.bpp<<16});
`;*/

  return `Graphics.prototype.setFont${this.id} = function() {
  // Actual height ${maxY+1-minY} (${maxY} - ${minY})
  // ${this.bpp} BPP
  return this.setFontCustom(
    ${encodedFont},
    ${charMin},
    ${fixedWidth?fontWidths[0]:`atob("${btoa(String.fromCharCode.apply(null,fontWidths))}")`},
    ${this.height}|${this.bpp<<16}
  );
}\n`;
}

// Output to a C header file (only works for 6px wide)
Font.prototype.getHeaderFile = function() {
  var PACK_DEFINE = "PACK_5_TO_32";
  var packedChars = 5;
  var packedPixels = 6;

  function genChar(ch) {
    var r = [];
    for (var y=0;y<fontInfo.fmHeight;y++) {
      var s = "";
      for (var x=0;x<packedPixels;x++) {
        s+= fontInfo.getCharPixel(ch,x,y) ? "X" : "_";
      }
      r.push(s);
    }
    return r;
  }

  var header = "";
  var ch = this.firstChar;
  while (ch <= this.lastChar) {
    var chars = [];
    for (var i=0;i<packedChars;i++) {
      chars.push(genChar(ch));
      ch++;
    }
    for (var cy=0;cy<fontInfo.fmHeight;cy++) {
      var s = " "+PACK_DEFINE+"( ";
      for (i=0;i<packedChars;i++) {
        if (i>0) s+=" , ";
        s += chars[i][cy];
      }
      s += " ),";
      header += s+"\n";
    }
    header += "\n";
  }
  return header;
}

// Output as a PBF file
Font.prototype.getPBF = function() {
  // https://github.com/pebble-dev/wiki/wiki/Firmware-Font-Format
  // setup to ensure we're not writing entire glyphs
  this.glyphPadX = 0;
  // now go through all glyphs
  var glyphs = [];
  var hashtableSize = 64;
  var hashes = [];
  for (var i=0;i<hashtableSize;i++)
    hashes[i] = [];
  var dataOffset = 0;
  Object.keys(this.glyphs).forEach(ch => {
    var bits = [];
    var glyph = this.glyphs[ch];
    glyph.appendBits(bits, {glyphVertical:false});
    glyph.bits = bits;
    glyph.bpp = this.bpp;
    // check if this glyph is just 1bpp - if so convert it
    if (glyph.bpp==2) {
      if (!glyph.bits.some(b => (b==1) || (b==2))) {
        //console.log(String.fromCharCode(glyph.ch)+" is 1bpp");
        glyph.bpp=1;
        glyph.bits = glyph.bits.map(b => b>>1);
      }
    }
    glyphs.push(glyph);
    glyph.hash = ch%hashtableSize;
    glyph.dataOffset = dataOffset;
    dataOffset += 5 + ((glyph.bits.length*glyph.bpp + 7)>>3); // supposedly we should be 4 byte aligned, but there seems no reason?
    hashes[glyph.hash].push(glyph);
  });

  var pbfHeader = new DataView(new ArrayBuffer(8));
  pbfHeader.setUint8(0, 2); // version
  pbfHeader.setUint8(1, this.height); // height
  pbfHeader.setUint16(2, glyphs.length, true/*LE*/); // glyph count
  pbfHeader.setUint16(4, 0, true/*LE*/); // wildcard codepoint
  pbfHeader.setUint8(6, hashtableSize); // hashtable Size
  pbfHeader.setUint8(7, 2); // codepoint size

  var pbfHashTable = new DataView(new ArrayBuffer(4 * hashtableSize));
  var n = 0, offsetSize = 0;
  hashes.forEach((glyphs,i) => {
    pbfHashTable.setUint8(n+0, i); // value - this is redundant by the look of it?
    pbfHashTable.setUint8(n+1, glyphs.length); // offset table size
    pbfHashTable.setUint16(n+2, offsetSize, true/*LE*/); // offset in pbfOffsetTable
    n +=4 ;
    offsetSize += 6*glyphs.length;
  });

  var pbfOffsetTable = new DataView(new ArrayBuffer(6 * glyphs.length));
  n = 0;
  hashes.forEach(glyphs => {
    glyphs.forEach(glyph => {
      pbfOffsetTable.setUint16(n+0, glyph.ch, true/*LE*/); // codepoint size = 2
      pbfOffsetTable.setUint32(n+2, glyph.dataOffset, true/*LE*/); // offset in data
      n+=6;
    });
  });

  var pbfGlyphTable = new DataView(new ArrayBuffer(dataOffset));
  n = 0;
  glyphs.forEach(glyph => {

    pbfGlyphTable.setUint8(n+0, glyph.width); // width
    pbfGlyphTable.setUint8(n+1, glyph.height); // height
    pbfGlyphTable.setInt8(n+2, glyph.xStart); // left
    pbfGlyphTable.setInt8(n+3, glyph.yStart); // top
    pbfGlyphTable.setUint8(n+4, glyph.advance | (glyph.bpp==2?128:0)); // advance (actually a int8)
    n+=5;
    // now add data
    var bytes = bitsToBytes(glyph.bits, glyph.bpp);
    bytes.forEach(b => {
      pbfGlyphTable.setUint8(n++, parseInt(b.toString(2).padStart(8,0).split("").reverse().join(""),2));
    });
  });

  // finally combine
  var fontFile = new Uint8Array(pbfHeader.byteLength + pbfHashTable.byteLength + pbfOffsetTable.byteLength + pbfGlyphTable.byteLength);
  fontFile.set(new Uint8Array(pbfHeader.buffer), 0);
  fontFile.set(new Uint8Array(pbfHashTable.buffer), pbfHeader.byteLength);
  fontFile.set(new Uint8Array(pbfOffsetTable.buffer), pbfHeader.byteLength + pbfHashTable.byteLength);
  fontFile.set(new Uint8Array(pbfGlyphTable.buffer), pbfHeader.byteLength + pbfHashTable.byteLength + pbfOffsetTable.byteLength);
  return fontFile;
}

/* Output PBF as a C file to include in the build

  options = {
    name : font name to use (no spaces!)
    path : path of output (with trailing slash)
    filename : filename (without .c/h)
  }
*/
Font.prototype.getPBFAsC = function(options) {
  var pbf = this.getPBF();
  require("fs").writeFileSync(options.path+options.filename+".h", `/*
 * This file is part of Espruino, a JavaScript interpreter for Microcontrollers
 *
 * Copyright (C) 2023 Gordon Williams <gw@pur3.co.uk>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * ----------------------------------------------------------------------------
 * Generated by Espruino/libs/graphics/font/fontconverter.js
 *
 * Contains Custom Fonts
 * ----------------------------------------------------------------------------
 */

#include "jsvar.h"

JsVar *jswrap_graphics_setFont${options.name}(JsVar *parent);
`);
  require("fs").writeFileSync(options.path+options.filename+".c", `/*
* This file is part of Espruino, a JavaScript interpreter for Microcontrollers
*
* Copyright (C) 2023 Gordon Williams <gw@pur3.co.uk>
*
* This Source Code Form is subject to the terms of the Mozilla Public
* License, v. 2.0. If a copy of the MPL was not distributed with this
* file, You can obtain one at http://mozilla.org/MPL/2.0/.
*
* ----------------------------------------------------------------------------
* This file is designed to be parsed during the build process
*
* Generated by Espruino/libs/graphics/font/fontconverter.js
*
* Contains Custom Fonts
* ----------------------------------------------------------------------------
*/

#include "${options.filename}.h"
#include "jswrap_graphics.h"

static const unsigned char pbfData[] = {
  ${pbf.map(b=>b.toString()).join(",").replace(/(............................................................................,)/g,"$1\n")}
};

/*JSON{
  "type" : "method",
  "class" : "Graphics",
  "name" : "setFont${options.name}",
  "generate" : "jswrap_graphics_setFont${options.name}",
  "return" : ["JsVar","The instance of Graphics this was called on, to allow call chaining"],
  "return_object" : "Graphics"
}
Set the current font
*/
JsVar *jswrap_graphics_setFont${options.name}(JsVar *parent) {
  JsVar *pbfVar = jsvNewNativeString(pbfData, sizeof(pbfData));
  JsVar *r = jswrap_graphics_setFontPBF(parent, pbfVar);
  jsvUnLock(pbfVar);
  return r;
}
`);
};

  // =======================================================
  return {
    Font : Font,
    load : load,
  };
}));
