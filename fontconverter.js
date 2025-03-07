/* https://github.com/espruino/EspruinoWebTools/fontconverter.js

 Copyright (C) 2024 Gordon Williams <gw@pur3.co.uk>

 This Source Code Form is subject to the terms of the Mozilla Public
 License, v. 2.0. If a copy of the MPL was not distributed with this
 file, You can obtain one at http://mozilla.org/MPL/2.0/.

 ----------------------------------------------------------------------------------------
  Bitmap font creator for Espruino Graphics custom fonts

  Takes input as a PNG font map, PBFF, or bitfontmaker2 JSON

  Outputs in various formats to make a custom font
 ----------------------------------------------------------------------------------------

Requires:

npm install btoa pngjs
*/
(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
      // AMD. Register as an anonymous module.
      define(['heatshrink'], factory);
  } else if (typeof module === 'object' && module.exports) {
      // Node. Does not work with strict CommonJS, but
      // only CommonJS-like environments that support module.exports,
      // like Node.
      module.exports = factory(require('./heatshrink.js'));
  } else {
      // Browser globals (root is window)
      root.fontconverter = factory(root.heatshrink);
  }
}(typeof self !== 'undefined' ? self : this, function(heatshrink) {

if ("undefined"==typeof btoa) btoa = function (input) {
    var b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var out = "";
    var i=0;
    while (i<input.length) {
      var octet_a = 0|input.charCodeAt(i++);
      var octet_b = 0;
      var octet_c = 0;
      var padding = 0;
      if (i<input.length) {
        octet_b = 0|input.charCodeAt(i++);
        if (i<input.length) {
          octet_c = 0|input.charCodeAt(i++);
          padding = 0;
        } else
          padding = 1;
      } else
        padding = 2;
      var triple = (octet_a << 0x10) + (octet_b << 0x08) + octet_c;
      out += b64[(triple >> 18) & 63] +
             b64[(triple >> 12) & 63] +
             ((padding>1)?'=':b64[(triple >> 6) & 63]) +
             ((padding>0)?'=':b64[triple & 63]);
    }
    return out;
  };

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

/*
{
  fn
  mapWidth,mapHeight
  mapOffsetX, mapOffsetY
  bpp                               // optional (default 1)
  height                            // height of individual character
  range : [ {min, max}, {min,max} ] // for characters to use
}
*/
function Font(info) {
  this.name = info.name;
  this.id = this.name ? this.name.replace(/[^A-Za-z0-9]/g,"") : "Unknown";
  this.fn = info.fn;
  this.height = 0|info.height;
  this.bpp = info.bpp||1;

  this.range = info.range;
  if (!this.range)
    this.range = getRanges().ASCII.range;

  this.fixedWidth = !!info.fixedWidth;
  this.fullHeight = !!info.fullHeight; // output fonts at the full height available
  this.glyphPadX = 1; // padding at the end of glyphs (needed for old-style JS fonts)
  this.glyphs = [];
  // set up later:
  // fmWidth  - max width of any character (we scan this area when writing fonts, even if we crop down later)
  // fmHeight - max height of any character (we scan this area when writing fonts, even if we crop down later)
  this.mapWidth = info.mapWidth||16; // for loadPNG
  this.mapHeight = info.mapHeight||16;
  this.mapOffsetX = 0|info.mapOffsetX;
  this.mapOffsetY = 0|info.mapOffsetY;
}

/*
    font            // owning font
    ch              // character number this represents
    getPixel(x,y)   // function to get a pixel within the font
    xStart
    yStart
    xEnd
    yEnd
    height
    advance
*/
function FontGlyph(font, ch, getPixel) {
  this.font = font;
  this.ch = ch;
  this.getPixel = getPixel;
  // set up later:
  //
}

// Populate the `glyphs` array with a range of glyphs
Font.prototype.generateGlyphs = function(getCharPixel) {
  this.range.forEach(range => {
    for (let ch=range.min; ch<=range.max; ch++) {
      let glyph = this.getGlyph(ch, (x,y) => getCharPixel(ch,x,y));
      if (glyph)
        this.glyphs[ch] = glyph;
    }
  });
};

// Is the given char code (int) in a range?
Font.prototype.isChInRange = function(ch) {
  return this.range.some(range => ch>=range.min && ch<=range.max);
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
  var map = "░█";
  if (this.font.bpp==2) map = "░▒▓█";
  var debugText = [];
  for (var y=0;y<this.font.height;y++) {
    debugText[y]="";
    for (var x=0;x<this.advance;x++) {
      var px = ".";
      if (x>=this.xStart && x<=this.xEnd && y>=this.yStart && y<=this.yEnd)
        px = map[this.getPixel(x,y)];
      debugText[y] += px;
    }
  }
  console.log("charcode ", this.ch);
  console.log(debugText.join("\n"));
};

/// Shift glyph up by the given amount (or down if negative)
FontGlyph.prototype.shiftUp = function(yOffset) {
  this.yStart -= yOffset;
  this.yEnd -= yOffset;
  var gp = this.getPixel.bind(this);
  this.getPixel = (x,y) => gp(x,y+yOffset);
};


/// Adjust glyph offsets so it fits within fontHeight
FontGlyph.prototype.nudge = function() {
  var y = 0;
  if (this.yStart < 0) y = this.yStart;
  if (this.yEnd-y >= this.font.height) {
    if (y) {
      console.log(`Can't nudge Glyph ${this.ch} as it's too big to fit in font map`);
      return;
    }
    y = this.yEnd+1-this.font.height;
  }
  if (y) {
    console.log(`Nudging Glyph ${this.ch} ${(y>0)?"up":"down"} by ${Math.abs(y)}`);
    this.shiftUp(y);
  }
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
    for (var y=0;y<this.fmHeight;y++) {
      for (var x=0;x<this.fmWidth;x++) {
        var set = glyph.getPixel(x,y);
        if (set) {
          // check X max value
          if (x<xStart) xStart = x;
          if (x>xEnd) xEnd = x;
          // check Y max/min
          if (y<yStart) yStart = y;
          if (y>yEnd) yEnd = y;
        }
      }
    }
    if (xStart>xEnd) {
      if (ch != 32) return undefined; // if it's empty and not a space, ignore it!
      xStart=0;
      xEnd = this.fmWidth >> 1; // treat spaces as half-width
    }
  }
  glyph.width = xEnd+1-xStart;
  glyph.xStart = xStart;
  glyph.xEnd = xEnd;
  glyph.advance = glyph.xEnd+1;
  glyph.advance += this.glyphPadX; // if not full width, add a space after
  //if (!this.glyphPadX) glyph.advance++; // hack - add once space of padding

  if (this.fullHeight) {
    yStart = 0;
    yEnd = this.fmHeight-1;
  }
  if (yStart>=yEnd) {
    yStart = 1;
    yEnd = 0;
  }
  glyph.yStart = yStart;
  glyph.yEnd = yEnd;
  glyph.height = yEnd+1-yStart;

/*  if (ch == 41) {
    glyph.debug();
    console.log(glyph);
    process.exit(1);
  }*/

  return glyph;
};

/// Shift all glyphs up by the given amount (or down if negative)
Font.prototype.shiftUp = function(y) {
  this.glyphs.forEach(glyph => glyph.shiftUp(y));
};


/// Adjust glyph offsets so it fits within fontHeight
Font.prototype.nudge = function() {
  this.glyphs.forEach(glyph => glyph.nudge());
}

/// Double the size of this font using a bitmap expandion algorithm
Font.prototype.doubleSize = function(smooth) {
  this.glyphs.forEach(glyph => {
    glyph.xStart *= 2;
    glyph.yStart *= 2;
    glyph.xEnd = glyph.xEnd*2 + 1;
    glyph.yEnd = glyph.yEnd*2 + 1;
    glyph.advance *= 2;
    var gp = glyph.getPixel.bind(glyph);
    if (smooth) {
      glyph.getPixel = (x,y) => {
        var hx = x>>1;
        var hy = y>>1;
        /*   A
        *  C P B
        *    D
        */
        let A = gp(hx,hy-1);
        let C = gp(hx-1,hy);
        let P = gp(hx,hy);
        let B = gp(hx+1,hy);
        let D = gp(hx,hy+1);
        //AdvMAME2×
        let p1=P, p2=P, p3=P, p4=P;
        if ((C==A) && (C!=D) && (A!=B)) p1=A;
        if ((A==B) && (A!=C) && (B!=D)) p2=B;
        if ((D==C) && (D!=B) && (C!=A)) p3=C;
        if ((B==D) && (B!=A) && (D!=C)) p4=D;
        let pixels = [[p1, p3], [p2, p4]];
        return pixels[x&1][y&1];
      };
    } else {
      glyph.getPixel = (x,y) => {
        return gp(x>>1,y>>1);
      };
    }
  });
  this.height *= 2;
  this.fmHeight *= 2;
  this.width *= 2;
};

// Load a 16x16 charmap file (or mapWidth x mapHeight)
function loadPNG(fontInfo) {
  var PNG = require("pngjs").PNG;
  var png = PNG.sync.read(require("fs").readFileSync(fontInfo.fn));

  console.log(`Font map is ${png.width}x${png.height}`);
  fontInfo.fmWidth = Math.floor((png.width - fontInfo.mapOffsetX) / fontInfo.mapWidth);
  fontInfo.fmHeight = Math.floor((png.height - fontInfo.mapOffsetY) / fontInfo.mapHeight);
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
    var chy = Math.floor(ch/fontInfo.mapWidth);
    var chx = ch - chy*fontInfo.mapWidth;
    var py = chy*fontInfo.fmHeight + y;
    if (py>=png.height) return false;
    return getPngPixel(fontInfo.mapOffsetX + chx*fontInfo.fmWidth + x, fontInfo.mapOffsetY + py);
  });
  return fontInfo;
}

function loadJSON(fontInfo) {
  // format used by https://www.pentacom.jp/pentacom/bitfontmaker2/editfont.php import/export
  var font = JSON.parse(require("fs").readFileSync(fontInfo.fn).toString());
  fontInfo.fmWidth = 16;
  fontInfo.fmHeight = 16;

  fontInfo.generateGlyphs(function(ch,x,y) {
    if (!font[ch]) return 0;
    return (((font[ch][y] >> x) & 1)!=0) ? 1 : 0;
  });
  return fontInfo;
}

function loadPBFF(fontInfo) {
  // format used by https://github.com/pebble-dev/renaissance/tree/master/files
  fontInfo.fmWidth = 0;
  fontInfo.fmHeight = fontInfo.height;
  fontInfo.glyphPadX = 0;
  fontInfo.fullHeight = false;
  var current = {
    idx : 0,
    bmp : []
  };
  var font = [];
  require("fs").readFileSync(fontInfo.fn).toString().split("\n").forEach(l => {
    if (l.startsWith("version")) {
    } else if (l.startsWith("fallback")) {
    } else if (l.startsWith("line-height")) {
      if (!fontInfo.fmHeight) // if no height specified
        fontInfo.fmHeight = 0|l.split(" ")[1];
      if (!fontInfo.height) // if no height specified
        fontInfo.height = 0|l.split(" ")[1];
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
        if (verticalOffset>0) while (verticalOffset--) current.bmp.push("");
      }
    } else if (l.startsWith(" ") || l.startsWith("#") || l=="") {
      current.bmp.push(l);
      if (l.length > fontInfo.fmWidth) fontInfo.fmWidth = l.length;
      if (current.bmp.length > fontInfo.fmHeight) {
        console.log("Char "+current.idx+" bump height to "+current.bmp.length);
        fontInfo.fmHeight = current.bmp.length;
      }
    } else if (l!="" && !l.startsWith("//")) console.log(`Unknown line '${l}'`);
  });

  fontInfo.generateGlyphs(function(ch,x,y) {
    if (!font[ch]) return 0;
    return (font[ch].bmp[y] && font[ch].bmp[y][x]=='#') ? 1 : 0;
  });
  return fontInfo;
}

function loadBDF(fontInfo) {
  var fontCharSet = "";
  var fontCharCode = 0;
  var fontBitmap = undefined;
  var fontBoundingBox = [0,0,0,0];
  var charBoundingBox = [0,0,0,0];
  var charAdvance = 0;
  var COMMENTS = "", FONTNAME = "";
  var glyphs = [];
  // https://en.wikipedia.org/wiki/Glyph_Bitmap_Distribution_Format

  require("fs").readFileSync(fontInfo.fn).toString().split("\n").forEach((line,lineNo) => {
    // Font stuff
    if (line.startsWith("CHARSET_REGISTRY"))
      fontCharSet = JSON.parse(line.split(" ")[1].trim());
    if (line.startsWith("COPYRIGHT"))
      COMMENTS += "// Copyright "+line.substr(9).trim()+"\n";
    if (line.startsWith("COMMENT"))
      COMMENTS += "// "+line.substr(7).trim()+"\n";
    if (line.startsWith("FONT"))
      FONTNAME += "// "+line.substr(4).trim();
    if (line.startsWith("FONTBOUNDINGBOX")) {
      fontBoundingBox = line.split(" ").slice(1).map(x=>parseInt(x));
      fontInfo.fmWidth = fontBoundingBox[0];
      fontInfo.height = fontInfo.fmHeight = fontBoundingBox[1] - fontBoundingBox[3];
    }
    // Character stuff
    if (line.startsWith("STARTCHAR")) {
      fontCharCode = undefined;
      charBoundingBox = [0,0,0,0];
      charAdvance = 0;
      fontBitmap=undefined;
    }
    if (line.startsWith("ENCODING")) {
      fontCharCode = parseInt(line.substr("ENCODING".length).trim());
    }
    if (line.startsWith("BBX ")) { // per character bounding box
      charBoundingBox = line.split(" ").slice(1).map(x=>parseInt(x));
    }
    if (line.startsWith("DWIDTH ")) { // per character bounding box
      charAdvance = parseInt(line.split(" ")[1]);
    }
    if (line=="ENDCHAR" && fontBitmap) {
      if (fontBitmap && fontInfo.isChInRange(fontCharCode)) {
        // first we need to pad this out
        var blankLine = " ".repeat(fontInfo.fmWidth);
        var linesBefore = fontBoundingBox[1]-(charBoundingBox[3]+charBoundingBox[1]);
        for (var i=0;i<linesBefore;i++)
          fontBitmap.unshift(blankLine);
        while (fontBitmap.length < fontInfo.fmHeight)
          fontBitmap.push(blankLine);

        let bmp = fontBitmap; // separate copy for this getGlyph fn
        let glyph = fontInfo.getGlyph(fontCharCode, (x,y) => {
          if (y<0 || y>=bmp.length) return 0;
          return bmp[y][x]=="1" ? 1 : 0;
         } );
       if (glyph) {
         // glyph.advance = charAdvance; // overwrite calculated advance value with one from file
         glyphs.push(glyph);
       }
      }
      fontCharCode = -1;
      fontBitmap=undefined;
    }
    if (fontBitmap!==undefined) {
      var l = "";
      for (var i=0;i<charBoundingBox[2];i++)
        l += " "; // padding
      for (var i=0;i<line.length;i++) {
        var c = parseInt(line[i],16);
        l += ((c+16).toString(2)).substr(-4).replace(/0/g," ");
      }
      fontBitmap.push(l);
    }
    if (line=="BITMAP") {
      fontBitmap=[];
    }
  });
  glyphs.sort((a,b) => a.ch - b.ch);
  glyphs.forEach(g => fontInfo.glyphs[g.ch] = g);
  return fontInfo;
}


function load(fontInfo) {
  fontInfo = new Font(fontInfo);
  if (fontInfo.fn && fontInfo.fn.endsWith("png")) return loadPNG(fontInfo);
  else if (fontInfo.fn && fontInfo.fn.endsWith("json")) return loadJSON(fontInfo);
  else if (fontInfo.fn && fontInfo.fn.endsWith("pbff")) return loadPBFF(fontInfo);
  else if (fontInfo.fn && fontInfo.fn.endsWith("bdf")) return loadBDF(fontInfo);
  else throw new Error("Unknown font type");
}



Font.prototype.debugPixelsUsed = function() {
  var pixelsUsedInRow = new Array(this.height);
  pixelsUsedInRow.fill(0);
  this.glyphs.forEach(glyph => {
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
  this.glyphs.forEach(glyph => {
    glyph.debug();
    console.log();
  });
};

/* GNU unifont puts in placeholders for unimplemented chars -
 big filled blocks with the 4 digit char code. This detects these
 and removes them */
Font.prototype.removeUnifontPlaceholders = function() {
  this.glyphs.forEach(glyph => {
    if (glyph.xStart==1 && glyph.yStart==1 && glyph.xEnd==14 && glyph.yEnd==14) {
      let borderEmpty = true;
      let edgesFilled = true;
      for (let x=1;x<15;x++) {
        if (glyph.getPixel(x,0)) borderEmpty = false;
        if (!glyph.getPixel(x,1)) edgesFilled = false;
        if (!glyph.getPixel(x,7)) edgesFilled = false;
        if (!glyph.getPixel(x,8)) edgesFilled = false;
        if (!glyph.getPixel(x,14)) edgesFilled = false;
        if (glyph.getPixel(x,15)) borderEmpty = false;
  //      console.log(x, glyph.getPixel(x,0), glyph.getPixel(x,1))
      }
      for (let y=1;y<14;y++) {
        if (glyph.getPixel(0,y)) borderEmpty = false;
        if (!glyph.getPixel(1,y)) edgesFilled = false;
        if (!glyph.getPixel(2,y)) edgesFilled = false;
        if (!glyph.getPixel(7,y)) edgesFilled = false;
        if (!glyph.getPixel(8,y)) edgesFilled = false;
        if (!glyph.getPixel(13,y)) edgesFilled = false;
        if (!glyph.getPixel(14,y)) edgesFilled = false;
      }
      if (borderEmpty && edgesFilled) {
        // it's a placeholder!
        // glyph.debug();
        delete this.glyphs[glyph.ch]; // remove it
      }
    }
  });
};

/* Outputs as JavaScript for a custom font.
  options = {
    compressed : bool
  }
*/
Font.prototype.getJS = function(options) {
  // options.compressed
  options = options||{};
  this.glyphPadX = 1;
  var charCodes = this.glyphs.map(g=>g.ch).filter(c=>c!==undefined).sort((a,b)=>a-b);
  var charMin = charCodes[0];
  var charMax = charCodes[charCodes.length-1];
  console.log(`Outputting char range ${charMin}..${charMax}`);
  // stats
  var minY = this.height;
  var maxY = 0;
  // get an array of bits
  var bits = [];
  var charGlyphs = [];
  var fontWidths = new Array(charMax+1);
  fontWidths.fill(0);
  this.glyphs.forEach(glyph => {
    if (glyph.yEnd > maxY) maxY = glyph.yEnd;
    if (glyph.yStart < minY) minY = glyph.yStart;
    // all glyphs have go 0...advance-1 now as we have no way to offset
    glyph.xStart = 0;
    glyph.yStart = 0;
    glyph.xEnd = glyph.advance-1;
    glyph.yEnd = this.height-1;
    glyph.width = glyph.xEnd + 1 - glyph.xStart;
    glyph.height = this.height;
    glyph.appendBits(bits, {glyphVertical:true});
    // create width array - widthBytes
    fontWidths[glyph.ch] = glyph.width;
  });
  // compact array
  var fontData = bitsToBytes(bits, this.bpp);
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
  var name = this.fmWidth+"X"+this.height;

  var PACK_DEFINE, decl, packedChars, packedPixels, storageType;

  if (this.fmWidth>4) {
    PACK_DEFINE = "PACK_5_TO_32";
    decl = `#define _____ 0
#define ____X 1
#define ___X_ 2
#define ___XX 3
#define __X__ 4
#define __X_X 5
#define __XX_ 6
#define __XXX 7
#define _X___ 8
#define _X__X 9
#define _X_X_ 10
#define _X_XX 11
#define _XX__ 12
#define _XX_X 13
#define _XXX_ 14
#define _XXXX 15
#define X____ 16
#define X___X 17
#define X__X_ 18
#define X__XX 19
#define X_X__ 20
#define X_X_X 21
#define X_XX_ 22
#define X_XXX 23
#define XX___ 24
#define XX__X 25
#define XX_X_ 26
#define XX_XX 27
#define XXX__ 28
#define XXX_X 29
#define XXXX_ 30
#define XXXXX 31
#define PACK_6_TO_32(A,B,C,D,E,F) ((A) | (B<<5) | (C<<10) | (D<<15) | (E<<20) | (F<<25))`;
    storageType = "unsigned int";
    packedChars = 5;
    packedPixels = 6;
  } else {
    PACK_DEFINE = "PACK_5_TO_16";
    decl = `#define ___ 0
#define __X 1
#define _X_ 2
#define _XX 3
#define X__ 4
#define X_X 5
#define XX_ 6
#define XXX 7
#define PACK_5_TO_16(A,B,C,D,E) ((A) | (B<<3) | (C<<6) | (D<<9) | (E<<12))`;
    storageType = "unsigned short";
    packedChars = 5;
    packedPixels = 3;
  }


  var charCodes = Object.keys(this.glyphs).map(n=>0|n).sort((a,b) => a-b);
  var charMin = charCodes[0];
  if (charMin==32) charMin++; // don't include space as it's a waste
  var charMax = charCodes[charCodes.length-1];
  console.log(`Outputting chars ${charMin} -> ${charMax}`);


  function genChar(font, glyph) {
    var r = [];
    for (var y=0;y<font.height;y++) {
      var s = "";
      for (var x=0;x<packedPixels;x++) {
        s+= glyph.getPixel(x + glyph.xStart,y) ? "X" : "_";
      }
      r.push(s);
    }
    return r;
  }

  var header = `/*
 * This file is part of Espruino, a JavaScript interpreter for Microcontrollers
 *
 * Copyright (C) 2013 Gordon Williams <gw@pur3.co.uk>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * ----------------------------------------------------------------------------
 * ${name.toLowerCase()} LCD font (but with last column as spaces)
 * ----------------------------------------------------------------------------
 */

#include "bitmap_font_${name.toLowerCase()}.h"

${decl}

#define LCD_FONT_${name}_CHARS ${charMax+1-charMin}
const ${storageType} LCD_FONT_${name}[] IN_FLASH_MEMORY = { // from ${charMin} up to ${charMax}\n`;
  var ch = charMin;
  while (ch <= charMax) {
    var chars = [];
    for (var i=0;i<packedChars;i++) {
      var glyph = this.glyphs[ch];
      if (glyph===undefined)
        glyph = { getPixel : () => false };
      chars.push(genChar(this, glyph));
      ch++;
    }
    for (var cy=0;cy<this.height;cy++) {
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
  header += "};\n";
  return header;
}

// Output as a PBF file, returns as a Uint8Array
Font.prototype.getPBF = function() {
  // https://github.com/pebble-dev/wiki/wiki/Firmware-Font-Format
  // setup to ensure we're not writing entire glyphs
  this.glyphPadX = 0;
  this.fullHeight = false; // TODO: too late?
  // now go through all glyphs
  var glyphs = [];
  var hashtableSize = ((this.glyphs.length)>1000) ? 255 : 64;
  var hashes = [];
  for (var i=0;i<hashtableSize;i++)
    hashes[i] = [];
  var dataOffset = 0;
  var allOffsetsFitIn16Bits = true;
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
    if (dataOffset > 65535)
      allOffsetsFitIn16Bits = false;
    dataOffset += 5 + ((glyph.bits.length*glyph.bpp + 7)>>3); // supposedly we should be 4 byte aligned, but there seems no reason?
    hashes[glyph.hash].push(glyph);
  });

  var useExtendedHashTableOffset = (6 * glyphs.length) > 65535;
  var use16BitOffsets = allOffsetsFitIn16Bits;
  var version = 3;//useExtendedHashTableOffset ? 3 : 2;
  if (version==2 && allOffsetsFitIn16Bits) throw new Error("16 bit offsets not supported in PBFv2");
  if (version==2 && useExtendedHashTableOffset) throw new Error("24 bit hashtable offsets not supported in PBFv2");
  console.log("Using PBF version "+version);
  console.log("  16 Bit Offsets = "+use16BitOffsets);
  console.log("  24 Bit HashTable = "+useExtendedHashTableOffset);

  var pbfOffsetTableEntrySize = use16BitOffsets ? 4 : 6;

  var pbfHeader = new DataView(new ArrayBuffer((version>=3) ? 10 : 8));
  pbfHeader.setUint8(0, version); // version
  pbfHeader.setUint8(1, this.height); // height
  pbfHeader.setUint16(2, glyphs.length, true/*LE*/); // glyph count
  pbfHeader.setUint16(4, 0, true/*LE*/); // wildcard codepoint
  pbfHeader.setUint8(6, hashtableSize); // hashtable Size
  pbfHeader.setUint8(7, 2); // codepoint size
  if (version>=3) {
    pbfHeader.setUint8(8, pbfHeader.byteLength ); // header length / hashtable offset
    var features  =
      (use16BitOffsets ? 1 : 0) |
      (useExtendedHashTableOffset ? 128 : 0);
    pbfHeader.setUint8(9, features); // features
  }

  console.log("offset table size "+(pbfOffsetTableEntrySize * glyphs.length)+", chars "+glyphs.length);

  var pbfHashTable = new DataView(new ArrayBuffer(4 * hashtableSize));
  var n = 0, offsetSize = 0;
  hashes.forEach((glyphs,i) => {
    if (glyphs.length > 255) throw new Error("Too many hash entries!");
    if (!useExtendedHashTableOffset && offsetSize > 65535) throw new Error("hashtable offset too big! "+offsetSize);
    // if useExtendedHashTableOffset (an Espruino hack) then we use the value as the extra 8 bits of offset
    pbfHashTable.setUint8(n+0, useExtendedHashTableOffset ? (offsetSize>>16) : i); // value - this is redundant by the look of it?
    pbfHashTable.setUint8(n+1, glyphs.length); // offset table size
    pbfHashTable.setUint16(n+2, offsetSize & 65535, true/*LE*/); // offset in pbfOffsetTable
    n +=4 ;
    offsetSize += pbfOffsetTableEntrySize*glyphs.length;
  });

  var pbfOffsetTable = new DataView(new ArrayBuffer(pbfOffsetTableEntrySize * glyphs.length));
  n = 0;
  hashes.forEach(glyphs => {
    glyphs.forEach(glyph => {
      pbfOffsetTable.setUint16(n+0, glyph.ch, true/*LE*/); // codepoint size = 2
      if (use16BitOffsets)
        pbfOffsetTable.setUint16(n+2, glyph.dataOffset, true/*LE*/); // offset in data
      else
        pbfOffsetTable.setUint32(n+2, glyph.dataOffset, true/*LE*/); // offset in data
      n += pbfOffsetTableEntrySize;
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
  if (1) {
    console.log(`Header     :\t0\t${pbfHeader.byteLength}`);
    console.log(`HashTable: \t${pbfHeader.byteLength}\t${pbfHashTable.byteLength}`);
    console.log(`OffsetTable:\t${pbfHeader.byteLength+pbfHashTable.byteLength}\t${pbfOffsetTable.byteLength}`);
    console.log(`GlyphTable: \t${pbfHeader.byteLength+pbfHashTable.byteLength+pbfOffsetTable.byteLength}\t${pbfGlyphTable.byteLength}`);
  }
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
    createdBy : string to use in "created by" line
  }
*/
Font.prototype.getPBFAsC = function(options) {
  var pbf = this.getPBF();
  options = options||{};
  if (!options.path) options.path="";
  if (!options.createdBy) options.createdBy="EspruinoWebTools/fontconverter.js"
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
 * Generated by ${options.createdBy}
 *
 * Contains Custom Fonts
 * ----------------------------------------------------------------------------
 */

#include "jsvar.h"

JsVar *jswrap_graphics_setFont${options.name}(JsVar *parent, int scale);
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
* Generated by ${options.createdBy}
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
  "params" : [
    ["scale","int","The scale factor, default=1 (2=2x size)"]
  ],
  "return" : ["JsVar","The instance of Graphics this was called on, to allow call chaining"],
  "return_object" : "Graphics"
}
Set the current font
*/
JsVar *jswrap_graphics_setFont${options.name}(JsVar *parent, int scale) {
  JsVar *pbfVar = jsvNewNativeString(pbfData, sizeof(pbfData));
  JsVar *r = jswrap_graphics_setFontPBF(parent, pbfVar, scale);
  jsvUnLock(pbfVar);
  return r;
}
`);
};

// Output as a PBFF file as String
Font.prototype.getPBFF = function() {
  var pbff = `version 2
line-height ${this.height}
`;
    //fallback 9647
  // setup to ensure we're not writing entire glyphs
  this.glyphPadX = 0;
  this.fullHeight = false; // TODO: too late?
  // now go through all glyphs
  Object.keys(this.glyphs).forEach(ch => {
    console.log(ch);
    var g = this.glyphs[ch];

   // glyph.appendBits(bits, {glyphVertical:false});
    pbff += `glyph ${ch} ${String.fromCharCode(ch)}\n`;
    pbff += `${"-".repeat(g.advance+1)} ${g.yStart}\n`;
    for (var y=g.yStart;y<=g.yEnd;y++) {
      var l = "";
      for (var x=0;x<=g.xEnd;x++) {
        var c  = g.getPixel(x,y);
        l += c?"#":" ";
      }
      pbff += l.trimEnd()+`\n`;
    }
    pbff += `-\n`;
  });

  return pbff;
}

// Renders the given text to a on object { width, height, bpp:32, data : Uint32Array }
Font.prototype.renderString = function(text) {
  // work out width
  var width = 0;
  for (var i=0;i<text.length;i++) {
    var ch = text.charCodeAt(i);
    if (!this.glyphs[ch]) continue;
    width += this.glyphs[ch].advance;
  }
  // allocate array
  var bmp = new Uint32Array(width * this.height);
  // render
  const bpp = this.bpp;
  var ox = 0;
  for (var i=0;i<text.length;i++) {
    var ch = text.charCodeAt(i);
    if (!this.glyphs[ch]) continue;
    var g = this.glyphs[ch];
    for (var y=g.yStart;y<=g.yEnd;y++) {
      for (var x=g.xStart;x<=g.xEnd;x++) {
        var c  = g.getPixel(x,y) << 8-bpp;
        c |= c>>bpp;
        c |= c>>(bpp*2);
        c |= c>>(bpp*4);
        var px = x+ox;
        if ((px>=0) && (px < width) && (y>=0) && (y<this.height))
          bmp[px + (y*width)] = 0xFF000000 | (c<<16) | (c<<8) | c;
      }
    }
    ox += this.glyphs[ch].advance;
  }
  // return
  return {width : width, height : this.height, bpp : 32, data : bmp };
};

// Render the given text and output it to the console
Font.prototype.printString = function(text) {
  var img = this.renderString(text);
  console.log("-".repeat(img.width));
  for (var y=0;y<img.height;y++) {
    var l = "";
    for (var x=0;x<img.width;x++) {
      var c = (img.data[x + (y*img.width)]&255) >> 6;
      l += "░▒▓█"[c];
    }
    console.log(l);
  }
  console.log("-".repeat(img.width));
}

/* Outputs an object containing suggested sets of characters, with the following fields:
{
  id : {
    id : string,
    range : [ {min:int,max:int}, ... ],
    text : string // test string
    charCount : // number of characters in range
  }
}
*/
function getRanges() {
  // https://arxiv.org/pdf/1801.07779.pdf#page=5 is handy to see what covers most writing
  var ranges = { // https://www.unicode.org/charts/
    "ASCII" : {range : [{ min : 32, max : 127 }], text: "This is a test" },
    "ASCII Capitals" : {range : [{ min : 32, max : 93 }], text: "THIS IS A TEST" },
    "Numeric" : {range : [{ min : 46, max : 58 }], text:"0.123456789:/" },
    "ISO8859-1":  {range : [{ min : 32, max : 255 }], text: "Thís îs ã tést" },
    "Extended":  {range : [{ min : 32, max : 1111 }], text: "Thís îs ã tést" }, // 150 languages + Cyrillic
    "All":  {range : [{ min : 32, max : 0xFFFF }], text: "이것 îs ã 测试" },
    "Chinese":  {range : [{ min : 32, max : 255 }, { min : 0x4E00, max : 0x9FAF }], text: "这是一个测试" },
    "Korean":  {range : [{ min : 32, max : 255 }, { min : 0x1100, max : 0x11FF }, { min : 0x3130, max : 0x318F }, { min : 0xA960, max : 0xA97F }, { min : 0xAC00, max : 0xD7FF }], text: "이것은 테스트입니다" },
    "Japanese":  {range : [{ min : 32, max : 255 }, { min : 0x3000, max : 0x30FF }, { min : 0x4E00, max : 0x9FAF }, { min : 0xFF00, max : 0xFFEF }], text: "これはテストです" },
  };
  for (var id in ranges) {
    ranges[id].id = id;
    ranges[id].charCount = ranges[id].range.reduce((a,r)=>a+r.max+1-r.min, 0);
  }
  return ranges;
}


/* load() loads a font. fontInfo should be:
  {
    fn : "font6x8.png", // currently a built-in font
    height : 8, // actual used height of font map
    range : [ min:32, max:255 ]
  }

  or:

  {
    fn : "renaissance_28.pbff",
    height : 28, // actual used height of font map
    range : [ min:32, max:255 ]
  }

  or:

  {
    fn : "font.bdf",  // Linux bitmap font format
  }

  or for a font made using https://www.pentacom.jp/pentacom/bitfontmaker2/

  {
    fn : "bitfontmaker2_14px.json",
    height : 14, // actual used height of font map
    range : [ min:32, max:255 ]
  }


  Afterwards returns a Font object populated with the args given, and
  a `function getCharPixel(ch,x,y)` which can be used to get the font data


load returns a `Font` class which contains:


  'generateGlyphs',   // used internally to create the `glyphs` array
  'getGlyph',         // used internally to create the `glyphs` array
  'debugPixelsUsed',  // show how many pixels used on each row
  'debugChars',       // dump all loaded chars
  'removeUnifontPlaceholders' // for GNU unitfont, remove placeholder characters

  'shiftUp'           // move chars up by X pixels
  'nudge'             // automatically move chars to fit in font box
  'doubleSize'        // double the size of the font using a pixel doubling algorithm to smooth edges - font may still need touchup after this

  'getJS',            // return the font as JS - only works for <1000 chars
  'getHeaderFile',    // return the font as a C header file (uses data for each char including blank ones)
  'getPBF',           // return a binary PBF file
                      //  eg. require("fs").writeFileSync("font.pbf", Buffer.from(font.getPBF()))
  'getPBFAsC'         // return a binary PBF file, but as a C file that can be included in Espruino

*/


  // =======================================================
  return {
    Font : Font,
    load : load, // load a font from a file (see above)
    getRanges : getRanges // get list of possible ranges of characters
  };
}));
