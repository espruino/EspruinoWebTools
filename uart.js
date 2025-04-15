/*
--------------------------------------------------------------------
Web Bluetooth / Web Serial Interface library for Nordic UART
                     Copyright 2021 Gordon Williams (gw@pur3.co.uk)
                     https://github.com/espruino/EspruinoWebTools
--------------------------------------------------------------------
This Source Code Form is subject to the terms of the Mozilla Public
License, v. 2.0. If a copy of the MPL was not distributed with this
file, You can obtain one at http://mozilla.org/MPL/2.0/.
--------------------------------------------------------------------
This creates a 'Puck' object that can be used from the Web Browser.

Simple usage:

  UART.write("LED1.set()\n")

Execute expression and return the result:

  UART.eval("BTN.read()").then(function(d) {
    alert(d);
  });
  // or old way:
  UART.eval("BTN.read()", function(d) {
    alert(d);
  });

Or write and wait for a result - this will return all characters,
including echo and linefeed from the REPL so you may want to send
`echo(0)` and use `console.log` when doing this.

  UART.write("1+2\n").then(function(d) {
    alert(d);
  });
  // or old way
  UART.write("1+2\n", function(d) {
    alert(d);
  });

Or more advanced usage with control of the connection
- allows multiple connections

  UART.connectAsync().then(function(connection) {
    if (!connection) throw "Error!";
    connection.on('data', function(d) { ... });
    connection.on('close', function() { ... });
    connection.on('error', function() { ... });
    connection.write("1+2\n", function() {
      connection.close();
    });
  });

Auto-connect to previously-used Web Serial devices when they're connected to USB:

  navigator.serial.addEventListener("connect", (event) => {
    const port = event.target;
    UART.connectAsync({serialPort:port}).then(connection=>console.log(connection));
  });

...or to a specific VID and PID when it is connected:

  navigator.serial.addEventListener("connect", async (event) => {
    const port = event.target;
    const portInfo = await port.getInfo();
    if (portInfo.usbVendorId==0x0483 && portInfo.usbProductId==0xA4F1) {
      UART.connectAsync({serialPort:port}).then(connection=>console.log(connection));
    } else {
      console.log("Unknown device connected");
    }
  });

You can also configure before opening a connection (see the bottom of this file for more info):

UART.ports = ["Web Serial"]; // force only Web Serial to be used
UART.debug = 3; // show all debug messages
etc...

As of Espruino 2v25 you can also send files:

UART.getConnection().espruinoSendFile("test.txt","This is a test of sending data to Espruino").then(_=>console.log("Done"))
UART.getConnection().espruinoSendFile("test.txt","This is a test of sending data to Espruino's SD card",{fs:true}).then(_=>console.log("Done"))

And receive them:

UART.getConnection().espruinoReceiveFile("test.txt", {}).then(contents=>console.log("Received", JSON.stringify(contents)));

Or evaluate JS on the device and return the response as a JS object:

UART.getConnection().espruinoEval("1+2").then(res => console.log("=",res));


ChangeLog:

...
1.14: Ignore 'backspace' character when searching for newlines
      Remove fs/noACK from espruinoSendFile if not needed
      Longer log messages
      Increase default delay to 450ms (to cope with devices in low speed 200ms connection interval mode reliably)
1.13: Ensure UART.eval waits for a newline for the result like the Puck.js lib (rather than just returning whatever there was)
1.12: Handle cases where platform doesn't support connection type better (reject with error message)
1.11: espruinoSendPacket now has a timeout (never timed out before)
      UART.writeProgress callback now correctly handles progress when sending a big file
      UART.writeProgress will now work in Web Serial when using espruinoSendFile
      espruinoReadfile has an optional progress callback
      Added UART.increaseMTU option for Web Bluetooth like Puck.js lib
      Added 'endpoint' field to the connection
      Fix port chooser formatting when spectre.css has changed some defaults
1.10: Add configurable timeouts
1.09: UART.write/eval now wait until they have received data with a newline in (if requested)
       and return the LAST received line, rather than the first (as before)
1.08: Add UART.getConnectionAsync()
      Add .espruinoEval(... {stmFix:true}) to work around occasional STM32 USB issue in 2v24 and earlier firmwares
      1s->2s packet timeout
      connection.write now returns a promise
1.07: Added UART.getConnection().espruinoEval
1.06: Added optional serialPort parameter to UART.connect(), allowing a known Web Serial port to be used
      Added connectAsync, and write/eval now return promises
1.05: Better handling of Web Serial disconnects
      UART.connect without arguments now works
      Fix issue using UART.write/eval if UART was opened with UART.connect()
      UART.getConnection() now returns undefined/isConnected()=false if UART has disconnected
1.04: For packet uploads, add ability to ste chunk size, report progress or even skip searching for acks
1.03: Added options for restricting what devices appear
      Improve Web Serial Disconnection - didn't work before
1.02: Added better on/emit/removeListener handling
      Add .espruinoSendPacket
1.01: Add UART.ports to allow available to user to be restricted
      Add configurable baud rate
      Updated modal dialog look (with common fn for selector and modal)
1.00: Auto-adjust BLE chunk size up if we receive >20 bytes in a packet
      Drop UART.debug to 1 (less info printed)
      Fixed flow control on BLE

To do:

* move 'connection.received' handling into removeListener and add an upper limit (100k?)
* add a 'line' event for each line of data that's received
* move XON/XOFF handling into Connection.rxDataHandler

*/
(function (root, factory) {
    if (typeof define === 'function' && define.amd) {
        // AMD. Register as an anonymous module.
        define([], factory);
    } else if (typeof module === 'object' && module.exports) {
        // Node. Does not work with strict CommonJS, but
        // only CommonJS-like environments that support module.exports,
        // like Node.
        module.exports = factory();
    } else {
        // Browser globals (root is window)
        root.UART = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {

  const NORDIC_SERVICE = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
  const NORDIC_TX = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
  const NORDIC_RX = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

  if (typeof navigator == "undefined") return;
  /// Are we busy, so new requests should be written to the queue (below)?
  var isBusy;
  /// A queue of operations to perform if UART.write/etc is called while busy
  var queue = [];

  function ab2str(buf) {
    return String.fromCharCode.apply(null, new Uint8Array(buf));
  }
  function str2ab(str) {
    var buf = new ArrayBuffer(str.length);
    var bufView = new Uint8Array(buf);
    for (var i=0, strLen=str.length; i<strLen; i++)
      bufView[i] = str.charCodeAt(i);
    return buf;
  }

  // parse a very relaxed version of JSON (returns undefined on failure)
  // Originally from https://github.com/espruino/EspruinoAppLoaderCore/blob/master/js/utils.js
  // Lexer from https://github.com/espruino/EspruinoTools/blob/master/core/utils.js
  function parseRJSON(str) {
    let lex = (function(str) { // Nasty lexer - no comments/etc
      var chAlpha="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";
      var chNum="0123456789";
      var chAlphaNum = chAlpha+chNum;
      var chWhiteSpace=" \t\n\r";
      // https://www-archive.mozilla.org/js/language/js20-2000-07/rationale/syntax.html#regular-expressions
      var allowedRegExIDs = ["abstract","break","case","catch","class","const","continue","debugger","default",
      "delete","do","else","enum","eval","export","extends","field","final","finally","for","function","goto",
      "if","implements","import","in","instanceof","native","new","package","private","protected","public",
      "return","static","switch","synchronized","throw","throws","transient","try","typeof","var","volatile","while","with"];
      var allowedRegExChars = ['!','%','&','*','+','-','/','<','=','>','?','[','{','}','(',',',';',':']; // based on Espruino jslex.c (may not match spec 100%)
      var ch;
      var idx = 0;
      var lineNumber = 1;
      var nextCh = function() {
        ch = str[idx++];
        if (ch=="\n") lineNumber++;
      };
      var backCh = function() {
        idx--;
        ch = str[idx-1];
      };
      nextCh();
      var isIn = function(s,c) { return s.indexOf(c)>=0; } ;
      var lastToken = {};
      var nextToken = function() {
        while (isIn(chWhiteSpace,ch)) {
          nextCh();
        }
        if (ch==undefined) return undefined;
        if (ch=="/") {
          nextCh();
          if (ch=="/") {
            // single line comment
            while (ch!==undefined && ch!="\n") nextCh();
            return nextToken();
          } else if (ch=="*") {
            nextCh();
            var last = ch;
            nextCh();
            // multiline comment
            while (ch!==undefined && !(last=="*" && ch=="/")) {
              last = ch;
              nextCh();
            }
            nextCh();
            return nextToken();
          } else {
            backCh(); // push the char back
          }
        }
        var s = "";
        var type, value;
        var startIdx = idx-1;
        if (isIn(chAlpha,ch)) { // ID
          type = "ID";
          do {
            s+=ch;
            nextCh();
          } while (isIn(chAlphaNum,ch));
        } else if (isIn(chNum,ch)) { // NUMBER
          type = "NUMBER";
          var chRange = chNum;
          if (ch=="0") { // Handle
            s+=ch;
            nextCh();
            if ("xXoObB".indexOf(ch)>=0) {
              if (ch=="b" || ch=="B") chRange="01";
              if (ch=="o" || ch=="O") chRange="01234567";
              if (ch=="x" || ch=="X") chRange="0123456789ABCDEFabcdef";
              s+=ch;
              nextCh();
            }
          }
          while (isIn(chRange,ch) || ch==".") {
            s+=ch;
            nextCh();
          }
        } else if (isIn("\"'`/",ch)) { // STRING or regex
          s+=ch;
          var q = ch;
          nextCh();
          // Handle case where '/' is just a divide character, not RegEx
          if (s=='/' && (lastToken.type=="STRING" || lastToken.type=="NUMBER" ||
                          (lastToken.type=="ID" && !allowedRegExIDs.includes(lastToken.str)) ||
                          (lastToken.type=="CHAR" && !allowedRegExChars.includes(lastToken.str))
                        )) {
            // https://www-archive.mozilla.org/js/language/js20-2000-07/rationale/syntax.html#regular-expressions
            type = "CHAR";
          } else {
            type = "STRING"; // should we report this as REGEX?
            value = "";

            while (ch!==undefined && ch!=q) {
              if (ch=="\\") { // handle escape characters
                nextCh();
                var escape = '\\'+ch;
                var escapeExtra = 0;
                if (ch=="x") {
                  nextCh();escape += ch;
                  nextCh();escape += ch;
                  value += String.fromCharCode(parseInt(escape.substr(2), 16));
                } else if (ch=="u") {
                  nextCh();escape += ch;
                  nextCh();escape += ch;
                  nextCh();escape += ch;
                  nextCh();escape += ch;
                  value += String.fromCharCode(parseInt(escape.substr(2), 16));
                } else {
                  try {
                    value += JSON.parse('"'+escape+'"');
                  } catch (e) {
                    value += escape;
                  }
                }
                s += escape;
              } else {
                s+=ch;
                value += ch;
              }
              nextCh();
            };
            if (ch!==undefined) s+=ch;
            nextCh();
          }
        } else {
          type = "CHAR";
          s+=ch;
          nextCh();
        }
        if (value===undefined) value=s;
        return lastToken={type:type, str:s, value:value, startIdx:startIdx, endIdx:idx-1, lineNumber:lineNumber};
      };

      return {
        next : nextToken
      };
    })(str);
    let tok = lex.next();
    function match(s) {
      if (tok.str!=s) throw new Error("Expecting "+s+" got "+JSON.stringify(tok.str));
      tok = lex.next();
    }

    function recurse() {
      let final = "";
      while (tok!==undefined) {
        if (tok.type == "NUMBER") {
          let v = parseFloat(tok.str);
          tok = lex.next();
          return v;
        }
        if (tok.str == "-") {
          tok = lex.next();
          let v = -parseFloat(tok.str);
          tok = lex.next();
          return v;
        }
        if (tok.type == "STRING") {
          let v = tok.value;
          tok = lex.next();
          return v;
        }
        if (tok.type == "ID") switch (tok.str) {
          case "true" : tok = lex.next(); return true;
          case "false" : tok = lex.next(); return false;
          case "null" : tok = lex.next(); return null;
        }
        if (tok.str == "[") {
          tok = lex.next();
          let arr = [];
          while (tok.str != ']') {
            arr.push(recurse());
            if (tok.str != ']') match(",");
          }
          match("]");
          return arr;
        }
        if (tok.str == "{") {
          tok = lex.next();
          let obj = {};
          while (tok.str != '}') {
            let key = tok.type=="STRING" ? tok.value : tok.str;
            tok = lex.next();
            match(":");
            obj[key] = recurse();
            if (tok.str != '}') match(",");
          }
          match("}");
          return obj;
        }
        match("EOF");
      }
    }

    let json = undefined;
    try {
      json = recurse();
    } catch (e) {
      console.log("RJSON parse error", e);
    }
    return json;
  }

  function handleQueue() {
    if (!queue.length) return;
    var q = queue.shift();
    log(3,"Executing "+JSON.stringify(q)+" from queue");
    if (q.type=="eval") uart.eval(q.expr, q.cb).then(q.resolve, q.reject);
    else if (q.type=="write") uart.write(q.data, q.callback, q.callbackNewline).then(q.resolve, q.reject);
    else log(1,"Unknown queue item "+JSON.stringify(q));
  }

  function log(level, s) {
    if (uart.log) uart.log(level, s);
  }

  /// Base connection class - BLE/Serial add their write/etc on top of this
  class Connection {
    endpoint = undefined; // Set to the endpoint used for this connection - eg maybe endpoint.name=="Web Bluetooth"
    // on/emit work for close/data/open/error/ack/nak/packet events
    on(evt,cb) { let e = "on"+evt; if (!this[e]) this[e]=[]; this[e].push(cb); }; // on only works with a single handler
    emit(evt,data1,data2) { let e = "on"+evt;  if (this[e]) this[e].forEach(fn=>fn(data1,data2)); };
    removeListener(evt,callback) { let e = "on"+evt;  if (this[e]) this[e]=this[e].filter(fn=>fn!=callback); };
    // on("open", () => ... ) connection opened
    // on("close", () => ... ) connection closed
    // on("data", (data) => ... ) when data is received (as string)
    // on("packet", (type,data) => ... ) when a packet is received (if .parsePackets=true)
    // on("ack", () => ... ) when an ACK is received (if .parsePackets=true)
    // on("nak", () => ... ) when an ACK is received (if .parsePackets=true)
    isOpen = false;       // is the connection actually open?
    isOpening = true;     // in the process of opening a connection?
    txInProgress = false; // is transmission in progress?
    parsePackets = false; // If set we parse the input stream for Espruino packet data transfers
    received = "";        // The data we've received so far - this gets reset by .write/eval/etc
    hadData = false;      // used when waiting for a block of data to finish being received
    rxDataHandlerLastCh = 0; // used by rxDataHandler - last received character
    rxDataHandlerPacket = undefined; // used by rxDataHandler - used for parsing
    rxDataHandlerTimeout = undefined; // timeout for unfinished packet
    progressAmt = 0;      // When sending a file, how many bytes through are we?
    progressMax = 0;      // When sending a file, how long is it in bytes? 0 if not sending a file
    /// Called when sending data, and we take this (along with progressAmt/progressMax) and create a more detailed progress report
    updateProgress(chars, charsMax) {
      if (chars===undefined) return uart.writeProgress();
      if (this.progressMax)
        uart.writeProgress(this.progressAmt+chars, this.progressMax);
      else
      uart.writeProgress(chars, charsMax);
    };
    /// Called when data is received, and passed it on to event listeners
    rxDataHandler(data) {
      log(3, "Received "+JSON.stringify(data));
      // TODO: handle XON/XOFF centrally here?
      if (this.parsePackets) {
        for (var i=0;i<data.length;i++) {
          let ch = data[i];
          // handle packet reception
          if (this.rxDataHandlerPacket!==undefined) {
            this.rxDataHandlerPacket += ch;
            ch = undefined;
            let flags = (this.rxDataHandlerPacket.charCodeAt(0)<<8) | this.rxDataHandlerPacket.charCodeAt(1);
            let len = flags & 0x1FFF;
            let rxLen = this.rxDataHandlerPacket.length;
            if (rxLen>=2 && rxLen>=(len+2)) {
              log(3, "Got packet end");
              if (this.rxDataHandlerTimeout) {
                clearTimeout(this.rxDataHandlerTimeout);
                this.rxDataHandlerTimeout = undefined;
              }
              this.emit("packet", flags&0xE000, this.rxDataHandlerPacket.substring(2));
              this.rxDataHandlerPacket = undefined; // stop packet reception
            }
          } else if (ch=="\x06") { // handle individual control chars
            log(3, "Got ACK");
            this.emit("ack");
            ch = undefined;
          } else if (ch=="\x15") {
            log(3, "Got NAK");
            this.emit("nak");
            ch = undefined;
          } else if (ch=="\x10") { // DLE - potential start of packet (ignore)
            this.rxDataHandlerLastCh = "\x10";
            ch = undefined;
          } else if (ch=="\x01" && this.rxDataHandlerLastCh=="\x10") { // SOH
            log(3, "Got packet start");
            this.rxDataHandlerPacket = "";
            this.rxDataHandlerTimeout = setTimeout(()=>{
              this.rxDataHandlerTimeout = undefined;
              log(0, "Packet timeout (2s)");
              this.rxDataHandlerPacket = undefined;
            }, 2000);
            ch = undefined;
          }
          if (ch===undefined) { // if we're supposed to remove the char, do it
            data = data.substring(0,i)+data.substring(i+1);
            i--;
          } else
            this.rxDataHandlerLastCh = ch;
        }
      }
      this.hadData = true;
      if (data.length>0) {
        // keep track of received data
        if (this.received.length < 100000) // ensure we're not creating a memory leak
          this.received += data;
        // forward any data
        if (this.cb) this.cb(data);
        this.emit('data', data);
      }
    }

    /* Send a packet of type "RESPONSE/EVAL/EVENT/FILE_SEND/DATA" to Espruino
       options = {
         noACK : bool (don't wait to acknowledgement - default=false)
         timeout : int (optional, milliseconds, default=5000) if noACK=false
       }
    */
    espruinoSendPacket(pkType, data, options) {
      options = options || {};
      if (!options.timeout) options.timeout=5000;
      if ("string"!=typeof data) throw new Error("'data' must be a String");
      if (data.length>0x1FFF) throw new Error("'data' too long");
      const PKTYPES = {
        RESPONSE : 0, // Response to an EVAL packet
        EVAL : 0x2000,  // execute and return the result as RESPONSE packet
        EVENT : 0x4000, // parse as JSON and create `E.on('packet', ...)` event
        FILE_SEND : 0x6000, // called before DATA, with {fn:"filename",s:123}
        DATA : 0x8000, // Sent after FILE_SEND with blocks of data for the file
        FILE_RECV : 0xA000 // receive a file - returns a series of PT_TYPE_DATA packets, with a final zero length packet to end
      }
      if (!pkType in PKTYPES) throw new Error("'pkType' not one of "+Object.keys(PKTYPES));
      let connection = this;
      return new Promise((resolve,reject) => {
        let timeout;
        function tidy() {
          if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
          }
          connection.removeListener("ack",onACK);
          connection.removeListener("nak",onNAK);
        }
        function onACK(ok) {
          tidy();
          setTimeout(resolve,0);
        }
        function onNAK(ok) {
          tidy();
          setTimeout(reject,0,"NAK while sending packet");
        }
        if (!options.noACK) {
          connection.parsePackets = true;
          connection.on("ack",onACK);
          connection.on("nak",onNAK);
        }
        let flags = data.length | PKTYPES[pkType];
        connection.write(String.fromCharCode(/*DLE*/16,/*SOH*/1,(flags>>8)&0xFF,flags&0xFF)+data, function() {
          // write complete
          if (options.noACK) {
            setTimeout(resolve,0); // if not listening for acks, just resolve immediately
          } else {
            timeout = setTimeout(function() {
              timeout = undefined;
              tidy();
              reject(`Timeout (${options.timeout}ms) while sending packet`);
            }, options.timeout);
          }
        }, err => {
          tidy();
          reject(err);
        });
      });
    }
    /* Send a file to Espruino using 2v25 packets.
       options = { // mainly passed to Espruino
         fs : true // optional -> write using require("fs") (to SD card)
         noACK : bool // (don't wait to acknowledgements)
         chunkSize : int // size of chunks to send (default 1024) for safety this depends on how big your device's input buffer is if there isn't flow control
         progress : (chunkNo,chunkCount)=>{} // callback to report upload progress
         timeout : int (optional, milliseconds, default=1000)
   } */
    espruinoSendFile(filename, data, options) {
      if ("string"!=typeof data) throw new Error("'data' must be a String");
      let CHUNK = 1024;
      options = options||{};
      options.fn = filename;
      options.s = data.length;
      let packetOptions = {};
      let progressHandler =  (chunkNo,chunkCount)=>{};
      if (options.noACK !== undefined) {
        packetOptions.noACK = !!options.noACK;
        delete options.noACK;
      }
      if (options.chunkSize) {
        CHUNK = options.chunkSize;
        delete options.chunkSize;
      }
      if (options.progress) {
        progressHandler = options.progress;
        delete options.progress;
      }
      options.fs = options.fs?1:0; // .fs => use SD card
      if (!options.fs) delete options.fs; // default=0, so just remove if it's not set
      let connection = this;
      let packetCount = 0, packetTotal = Math.ceil(data.length/CHUNK)+1;
      connection.progressAmt = 0;
      connection.progressMax = data.length;
      // always ack the FILE_SEND
      progressHandler(0, packetTotal);
      return connection.espruinoSendPacket("FILE_SEND",JSON.stringify(options)).then(sendData, err=> {
        connection.progressAmt = 0;
        connection.progressMax = 0;
        throw err;
      });
      // but if noACK don't ack for data
      function sendData() {
        connection.progressAmt += CHUNK;
        progressHandler(++packetCount, packetTotal);
        if (data.length==0) {
          connection.progressAmt = 0;
          connection.progressMax = 0;
          return Promise.resolve();
        }
        let packet = data.substring(0, CHUNK);
        data = data.substring(CHUNK);
        return connection.espruinoSendPacket("DATA", packet, packetOptions).then(sendData, err=> {
          connection.progressAmt = 0;
          connection.progressMax = 0;
          throw err;
        });
      }
    }
    /* Receive a file from Espruino using 2v25 packets.
       options = { // mainly passed to Espruino
         fs : true // optional -> write using require("fs") (to SD card)
         timeout : int // milliseconds timeout (default=1000)
         progress : (bytes)=>{} // callback to report upload progress
       }
   } */
    espruinoReceiveFile(filename, options) {
      options = options||{};
      options.fn = filename;
      if (!options.progress)
        options.progress =  (bytes)=>{};
      let connection = this;
      return new Promise((resolve,reject) => {
        let fileContents = "", timeout;
        function scheduleTimeout() {
          if (timeout) clearTimeout(timeout);
          timeout = setTimeout(() => {
            timeout = undefined;
            cleanup();
            reject("espruinoReceiveFile Timeout");
          }, options.timeout || 1000);
        }
        function cleanup() {
          connection.removeListener("packet", onPacket);
          if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
          }
        }
        function onPacket(type,data) {
          if (type!=0x8000) return; // ignore things that are not DATA packet
          if (data.length==0) { // 0 length packet = EOF
            cleanup();
            setTimeout(resolve,0,fileContents);
          } else {
            fileContents += data;
            options.progress(fileContents.length);
            scheduleTimeout();
          }
        }
        connection.parsePackets = true;
        connection.on("packet", onPacket);
        scheduleTimeout();
        options.progress(0);
        connection.espruinoSendPacket("FILE_RECV",JSON.stringify(options)).then(()=>{
          // now wait...
        }, err => {
          cleanup();
          reject(err);
        });
      });
    }
    /* Send a JS expression to be evaluated on Espruino using using 2v25 packets.
        options = {
           timeout : int // milliseconds timeout (default=1000)
           stmFix : bool // if set, this works around an issue in Espruino STM32 2v24 and earlier where USB could get in a state where it only sent small chunks of data at a time
        }*/
    espruinoEval(expr, options) {
      options = options || {};
      if ("string"!=typeof expr) throw new Error("'expr' must be a String");
      let connection = this;
      return new Promise((resolve,reject) => {
        let prodInterval;

        function cleanup() {
          connection.removeListener("packet", onPacket);
          if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
          }
          if (prodInterval) {
            clearInterval(prodInterval);
            prodInterval = undefined;
          }
        }
        function onPacket(type,data) {
          if (type!=0) return; // ignore things that are not a response
          cleanup();
          setTimeout(resolve,0,parseRJSON(data));
        }
        connection.parsePackets = true;
        connection.on("packet", onPacket);
        let timeout = setTimeout(() => {
          timeout = undefined;
          cleanup();
          reject("espruinoEval Timeout");
        }, options.timeout || 1000);
        connection.espruinoSendPacket("EVAL",expr,{noACK:options.stmFix}).then(()=>{
          // resolved/rejected with 'packet' event or timeout
          if (options.stmFix)
            prodInterval = setInterval(function() {
              connection.write(" \x08") // space+backspace
              .catch(err=>{
                console.error("Error sending STM fix:",err);
                cleanup();
              });
            }, 50);
        }, err => {
          cleanup();
          reject(err);
        });
      });
    }
  };

  /// Endpoints for each connection method
  var endpoints = [];
  endpoints.push({
    name : "Web Bluetooth",
    description : "Bluetooth LE devices",
    svg : '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path d="M17.71 7.71L12 2h-1v7.59L6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 11 14.41V22h1l5.71-5.71-4.3-4.29 4.3-4.29zM13 5.83l1.88 1.88L13 9.59V5.83zm1.88 10.46L13 18.17v-3.76l1.88 1.88z" fill="#ffffff"/></svg>',
    isSupported : function() {
      if (navigator.platform.indexOf("Win")>=0 &&
          (navigator.userAgent.indexOf("Chrome/54")>=0 ||
           navigator.userAgent.indexOf("Chrome/55")>=0 ||
           navigator.userAgent.indexOf("Chrome/56")>=0)
          )
        return "Chrome <56 in Windows has navigator.bluetooth but it's not implemented properly";;
      if (window && window.location && window.location.protocol=="http:" &&
          window.location.hostname!="localhost")
        return "Serving off HTTP (not HTTPS) - Web Bluetooth not enabled";
      if (navigator.bluetooth) return true;
      var iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
      if (iOS) {
        return "To use Web Bluetooth on iOS you'll need the WebBLE App.\nPlease go to https://itunes.apple.com/us/app/webble/id1193531073 to download it.";
      } else {
        return "This Web Browser doesn't support Web Bluetooth.\nPlease see https://www.espruino.com/Puck.js+Quick+Start";
      }
    },
    connect : function(connection, options) {
      options = options || {};
      /* options = {
         // nothing yet...
       }
       */
      var DEFAULT_CHUNKSIZE = 20;

      var btServer = undefined;
      var btService;
      var connectionDisconnectCallback;
      var txCharacteristic;
      var rxCharacteristic;
      var txDataQueue = [];
      var flowControlXOFF = false;
      var chunkSize = DEFAULT_CHUNKSIZE;

      connection.close = function(callback) {
        connection.isOpening = false;
        if (connection.isOpen) {
          connection.isOpen = false;
          connection.emit('close');
        } else {
          if (callback) callback(null);
        }
        if (btServer) {
          btServer.disconnect();
          btServer = undefined;
          txCharacteristic = undefined;
          rxCharacteristic = undefined;
        }
      };

      connection.write = function(data, callback) {
        return new Promise((resolve,reject) => {
          if (data) txDataQueue.push({data:data,callback:callback,maxLength:data.length,resolve:resolve});
          if (connection.isOpen && !connection.txInProgress) writeChunk();

          function writeChunk() {
            if (flowControlXOFF) { // flow control - try again later
              setTimeout(writeChunk, 50);
              return;
            }
            var chunk;
            if (!txDataQueue.length) {
              connection.updateProgress();
              return;
            }
            var txItem = txDataQueue[0];
            connection.updateProgress(txItem.maxLength - txItem.data.length, txItem.maxLength);
            if (txItem.data.length <= chunkSize) {
              chunk = txItem.data;
              txItem.data = undefined;
            } else {
              chunk = txItem.data.substr(0,chunkSize);
              txItem.data = txItem.data.substr(chunkSize);
            }
            connection.txInProgress = true;
            log(2, "Sending "+ JSON.stringify(chunk.length>80?chunk.substr(0,80)+"...":chunk));
            txCharacteristic.writeValue(str2ab(chunk)).then(function() {
              log(3, "Sent");
              if (!txItem.data) {
                txDataQueue.shift(); // remove this element
                if (txItem.callback)
                  txItem.callback();
                if (txItem.resolve)
                  txItem.resolve();
              }
              connection.txInProgress = false;
              writeChunk();
            }).catch(function(error) {
              log(1, 'SEND ERROR: ' + error);
              txDataQueue = [];
              connection.close();
            });
          }
        });
      };

      return navigator.bluetooth.requestDevice(uart.optionsBluetooth).then(function(device) {
        log(1, 'Device Name:       ' + device.name);
        log(1, 'Device ID:         ' + device.id);
        // Was deprecated: Should use getPrimaryServices for this in future
        //log('BT>  Device UUIDs:      ' + device.uuids.join('\n' + ' '.repeat(21)));
        device.addEventListener('gattserverdisconnected', function() {
          log(1, "Disconnected (gattserverdisconnected)");
          connection.close();
        });
        return device.gatt.connect();
      }).then(function(server) {
        log(1, "Connected");
        btServer = server;
        return server.getPrimaryService(NORDIC_SERVICE);
      }).then(function(service) {
        log(2, "Got service");
        btService = service;
        return btService.getCharacteristic(NORDIC_RX);
      }).then(function (characteristic) {
        rxCharacteristic = characteristic;
        log(2, "RX characteristic:"+JSON.stringify(rxCharacteristic));
        rxCharacteristic.addEventListener('characteristicvaluechanged', function(event) {
          var dataview = event.target.value;
          if (uart.increaseMTU && (dataview.byteLength > chunkSize)) {
            log(2, "Received packet of length "+dataview.byteLength+", increasing chunk size");
            chunkSize = dataview.byteLength;
          }
          if (uart.flowControl) {
            for (var i=0;i<dataview.byteLength;i++) {
              var ch = dataview.getUint8(i);
              if (ch==17) { // XON
                log(2,"XON received => resume upload");
                flowControlXOFF = false;
              }
              if (ch==19) { // XOFF
                log(2,"XOFF received => pause upload");
                flowControlXOFF = true;
              }
            }
          }
          connection.rxDataHandler(ab2str(dataview.buffer));
        });
        return rxCharacteristic.startNotifications();
      }).then(function() {
        return btService.getCharacteristic(NORDIC_TX);
      }).then(function (characteristic) {
        txCharacteristic = characteristic;
        log(2, "TX characteristic:"+JSON.stringify(txCharacteristic));
      }).then(function() {
        connection.txInProgress = false;
        connection.isOpen = true;
        connection.isOpening = false;
        isBusy = false;
        queue = [];
        connection.emit('open');
        // if we had any writes queued, do them now
        connection.write();
        return connection;
      }).catch(function(error) {
        log(1, 'ERROR: ' + error);
        connection.close();
        return Promise.reject(error);
      });
    }
  });
  endpoints.push({
    name : "Web Serial",
    description : "USB connected devices",
    svg : '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path d="M15 7v4h1v2h-3V5h2l-3-4-3 4h2v8H8v-2.07c.7-.37 1.2-1.08 1.2-1.93 0-1.21-.99-2.2-2.2-2.2-1.21 0-2.2.99-2.2 2.2 0 .85.5 1.56 1.2 1.93V13c0 1.11.89 2 2 2h3v3.05c-.71.37-1.2 1.1-1.2 1.95 0 1.22.99 2.2 2.2 2.2 1.21 0 2.2-.98 2.2-2.2 0-.85-.49-1.58-1.2-1.95V15h3c1.11 0 2-.89 2-2v-2h1V7h-4z" fill="#ffffff"/></svg>',
    isSupported : function() {
      if (!navigator.serial)
        return "No navigator.serial - Web Serial not enabled";
      if (window && window.location && window.location.protocol=="http:" &&
          window.location.hostname!="localhost")
        return "Serving off HTTP (not HTTPS) - Web Serial not enabled";
      return true;
    },
    connect : function(connection, options) {
      options = options || {};
      /* options = {
         serialPort : force a serialport, otherwise pop up a menu
       }
       */
      let serialPort, reader, writer;
      function disconnected() {
        connection.isOpening = false;
        if (connection.isOpen) {
          log(1, "Disconnected");
          connection.isOpen = false;
          connection.emit('close');
        }
      }

      connection.close = function(callback) {
        if (writer) {
          writer.close();
          writer = undefined;
        }
        if (reader) {
          reader.cancel();
        }
        // readLoop will finish and *that* calls disconnect and cleans up
      };
      connection.write = function(data, callback, alreadyRetried) {
        return new Promise((resolve, reject) => {
          if (!serialPort || !serialPort.writable) return reject ("Not connected");
          if (serialPort.writable.locked) {
            if (alreadyRetried)
              return reject("Writable stream is locked");
            log(0,'Writable stream is locked - retry in 500ms');
            setTimeout(()=>{ this.write(data, callback, true).then(resolve, reject); }, 500);
            return;
          }
          writer = serialPort.writable.getWriter();
          log(2, "Sending "+ JSON.stringify(data));
          connection.updateProgress(0, data.length);
          writer.write(str2ab(data)).then(function() {
            connection.updateProgress();
            writer.releaseLock();
            writer = undefined;
            log(3, "Sent");
            if (callback) callback();
            resolve();
          }).catch(function(error) {
            connection.updateProgress();
            if (writer) {
              writer.releaseLock();
              writer.close();
            }
            writer = undefined;
            log(0,'SEND ERROR: ' + error);
            reject(error);
          });
        });
      };

      return (options.serialPort ?
        Promise.resolve(options.serialPort) :
        navigator.serial.requestPort(uart.optionsSerial)).then(function(port) {
        log(1, "Connecting to serial port");
        serialPort = port;
        return port.open({ baudRate: uart.baud });
      }).then(function () {
        function readLoop() {
          reader = serialPort.readable.getReader();
          reader.read().then(function ({ value, done }) {
            reader.releaseLock();
            reader = undefined;
            if (value)
              connection.rxDataHandler(ab2str(value.buffer));
            if (done) { // connection is closed
              if (serialPort) {
                serialPort.close();
                serialPort = undefined;
              }
              disconnected();
            } else { // else continue reading
              readLoop();
            }
          }, function(error) { // read() rejected...
            reader.releaseLock();
            log(0, 'ERROR: ' + error);
            if (serialPort) {
              serialPort.close();
              serialPort = undefined;
            }
            disconnected();
        });
        }
        readLoop();
        log(1,"Serial connected. Receiving data...");
        connection.txInProgress = false;
        connection.isOpen = true;
        connection.isOpening = false;
        return connection;
      }).catch(function(error) {
        log(0, 'ERROR: ' + error);
        disconnected();
        return Promise.reject(error);
      });
    }
  });
  // ======================================================================
  /* Create a modal window.
    options = {
          title : string
          contents = DomElement | string
          onClickBackground : function
          onClickMenu : function
    }
    returns {
      remove : function(); // remove menu
    }
  */
  function createModal(options) {
    // modal
    var e = document.createElement('div');
    e.style = 'position:absolute;top:0px;left:0px;right:0px;bottom:0px;opacity:0.5;z-index:100;background:black;';
    // menu
    var menu = document.createElement('div');
    menu.style = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);font-family: Sans-Serif;z-index:101;min-width:300px';
    var menutitle = document.createElement('div');
    menutitle.innerText = options.title;
    menutitle.style = 'color:#fff;background:#000;padding:8px 8px 4px 8px;font-weight:bold;';
    menu.appendChild(menutitle);

    var items = document.createElement('div');
    items.style = 'color:#000;background:#fff;padding:4px 8px 4px 8px;min-height:4em';
    if ("string" == typeof options.contents)
      items.innerHTML = options.contents;
    else
      items.appendChild(options.contents);
    menu.appendChild(items);
    document.body.appendChild(e);
    document.body.appendChild(menu);
    e.onclick = function(evt) { // clicked modal -> remove
      evt.preventDefault();
      result.remove();
      if (options.onClickBackground)
        options.onClickBackground();
    };
    menu.onclick = function(evt) { // clicked menu
      evt.preventDefault();
      if (options.onClickMenu)
        options.onClickMenu();
    };

    var result = {
      remove : function() {
        document.body.removeChild(menu);
        document.body.removeChild(e);
      }
    };
    return result;
  }
  // ======================================================================
  var connection;
  function connect(options) {
    connection = new Connection();
    return new Promise((resolve, reject) => {
      if (uart.ports.length==0) {
        console.error(`UART: No ports in uart.ports`);
        return reject(`UART: No ports in uart.ports`);
      }
      if (uart.ports.length==1) {
        var endpoint = endpoints.find(ep => ep.name == uart.ports[0]);
        if (endpoint===undefined) {
          return reject(`UART: Port Named "${uart.ports[0]}" not found`);
        }
        var supported = endpoint.isSupported();
        if (supported!==true)
          return reject(endpoint.name+" is not supported on this platform: "+supported);
        return endpoint.connect(connection, options).then(resolve, reject);
      }

      var items = document.createElement('div');
      var supportedEndpoints = 0;
      uart.ports.forEach(function(portName) {
        var endpoint = endpoints.find(ep => ep.name == portName);
        if (endpoint===undefined) {
          console.error(`UART: Port Named "${portName}" not found`);
          return;
        }
        var supported = endpoint.isSupported();
        if (supported!==true) {
          log(0, endpoint.name+" not supported, "+supported);
          return;
        }
        var ep = document.createElement('div');
        ep.style = 'width:300px;height:60px;background:#ccc;margin:4px 0px 4px 0px;padding:0px 0px 0px 68px;cursor:pointer;line-height: normal;';
        ep.innerHTML = '<div style="position:absolute;box-sizing:content-box;left:8px;width:48px;height:48px;background:#999;padding:6px;cursor:pointer;">'+endpoint.svg+'</div>'+
                      '<div style="font-size:150%;padding-top:8px;">'+endpoint.name+'</div>'+
                      '<div style="font-size:80%;color:#666">'+endpoint.description+'</div>';
        ep.onclick = function(evt) {
          connection.endpoint = endpoint;
          endpoint.connect(connection, options).then(resolve, reject);
          evt.preventDefault();
          menu.remove();
        };
        items.appendChild(ep);
        supportedEndpoints++;
      });
      if (supportedEndpoints==0)
        return reject(`No connection methods (${uart.ports.join(", ")}) supported on this platform`);

      var menu = createModal({
        title:"SELECT A PORT...",
        contents:items,
        onClickBackground:function() {
          uart.log(1,"User clicked outside modal - cancelling connect");
          connection.isOpening = false;
          connection.emit('error', "Model closed.");
        }
      });
    });
  }

  // Push the given operation to the queue, return a promise
  function pushToQueue(operation) {
    log(3, `Busy - adding ${operation.type} to queue`);
    return new Promise((resolve,reject) => {
      operation.resolve = resolve;
      operation.reject = reject;
      queue.push(operation);
    });
  }
  // ======================================================================
  /* convenience function... Write data, call the callback with data:
       callbackNewline = false => if no new data received for ~0.2 sec
       callbackNewline = true => after a newline */
  function write(data, callback, callbackNewline) {
    if (isBusy)
      return pushToQueue({type:"write", data:data, callback:callback, callbackNewline:callbackNewline});

    return new Promise((resolve,reject) => {
      var cbTimeout;
      function onWritten() {
        if (callbackNewline) {
          connection.cb = function(d) {
            // if we hadn't got a newline this time (even if we had one before)
            // then ignore it (https://github.com/espruino/BangleApps/issues/3771)
            if (!d.includes("\n")) return;
            // now return the LAST received non-empty line
            var lines = connection.received.split("\n");
            var idx = lines.length-1;
            while (lines[idx].replaceAll("\b","").trim().length==0 && idx>0) idx--; // skip over empty lines (incl backspace \b)
            var line = lines.splice(idx,1)[0]; // get the non-empty line
            connection.received = lines.join("\n"); // put back other lines
            // remove handler and return
            connection.cb = undefined;
            if (cbTimeout) clearTimeout(cbTimeout);
            cbTimeout = undefined;
            if (callback)
              callback(line);
            resolve(line);
            isBusy = false;
            handleQueue();
          };
        }
        // wait for any received data if we have a callback...
        var maxTime = uart.timeoutMax; // Max time we wait in total, even if getting data
        var dataWaitTime = callbackNewline ? uart.timeoutNewline : uart.timeoutNormal;
        var maxDataTime = dataWaitTime; // max time we wait after having received data
        const POLLINTERVAL = 100;
        cbTimeout = setTimeout(function timeout() {
          cbTimeout = undefined;
          if (maxTime>0) maxTime-=POLLINTERVAL;
          if (maxDataTime>0) maxDataTime-=POLLINTERVAL;
          if (connection.hadData) maxDataTime=dataWaitTime;
          if (maxDataTime>0 && maxTime>0) {
            cbTimeout = setTimeout(timeout, 100);
          } else {
            connection.cb = undefined;
            if (callbackNewline)
              log(2, "write waiting for newline timed out");
            if (callback)
              callback(connection.received);
            resolve(connection.received);
            isBusy = false;
            handleQueue();
            connection.received = "";
          }
          connection.hadData = false;
        }, 100);
      }

      if (connection && connection.isOpen) {
        if (!connection.txInProgress) connection.received = "";
        isBusy = true;
        return connection.write(data, onWritten);
      }

      return connect().then(function(connection) {
        isBusy = true;
        connection.write(data, onWritten/*calls resolve*/);
      }, function(error) {
        reject(error);
      });
    });
  }

  function evaluate(expr, cb) {
    if (isBusy)
      return pushToQueue({type:"eval", expr:expr, cb:cb});
    return write('\x10eval(process.env.CONSOLE).println(JSON.stringify('+expr+'))\n',undefined,true/*callback on newline*/).then(function(d) {
      try {
        var json = JSON.parse(d.trim());
        if (cb) cb(json);
        return json;
      } catch (e) {
        let err = "Unable to decode "+JSON.stringify(d)+", got "+e.toString();
        log(1, err);
        if (cb) cb(null, err);
        return Promise.reject(err);
      }
    }, true/*callbackNewline*/);
  };

  // ----------------------------------------------------------

  var uart = {
    version : "1.14",
    /// Are we writing debug information? 0 is no, 1 is some, 2 is more, 3 is all.
    debug : 1,
    /// Should we use flow control? Default is true
    flowControl : true,
    /// Which ports should be offer to the user? If only one is specified no modal menu is created
    ports : ["Web Bluetooth","Web Serial"],
    /// Baud rate for Web Serial connections (Official Espruino devices use 9600, Espruino-on-ESP32/etc use 115200)
    baud : 115200,
    /// timeout (in ms) in .write when waiting for any data to return
    timeoutNormal : 450, // 450ms is enough time that with a slower 200ms connection interval and a delay we should be ok
    /// timeout (in ms) in .write/.eval when waiting for a newline
    timeoutNewline : 10000,
    /// timeout (in ms) to wait at most
    timeoutMax : 30000,
    /** Web Bluetooth: When we receive more than 20 bytes, should we increase the chunk size we use
    for writing to match it? Normally this is fine but it seems some phones have a broken bluetooth implementation that doesn't allow it. */
    increaseMTU : true,
    /// Used internally to write log information - you can replace this with your own function
    log : function(level, s) { if (level <= this.debug) console.log("<UART> "+s)},
    /// Called with the current send progress or undefined when done - you can replace this with your own function
    writeProgress : function (charsSent, charsTotal) {
      //console.log(charsSent + "/" + charsTotal);
    },
    /** Connect to a new device - this creates a separate
     connection to the one `write` and `eval` use. */
    connectAsync : connect, // connectAsync(options)
    connect : (callback, options) => { // for backwards compatibility
      connect(options).then(callback, err => callback(null,err));
      return connection;
    },
    /// Write to a device and callback when the data is written (returns promise, or can take callback).  Creates a connection if it doesn't exist
    write : write, // write(string, callback, callbackForNewline) -> Promise
    /// Evaluate an expression and call cb with the result (returns promise, or can take callback). Creates a connection if it doesn't exist
    eval : evaluate, // eval(expr_as_string, callback) -> Promise
    /// Write the current time to the device
    setTime : function(cb) {
      var d = new Date();
      var cmd = 'setTime('+(d.getTime()/1000)+');';
      // in 1v93 we have timezones too
      cmd += 'if (E.setTimeZone) E.setTimeZone('+d.getTimezoneOffset()/-60+');\n';
      write(cmd, cb);
    },
    /// Did `write` and `eval` manage to create a connection?
    isConnected : function() {
      return connection!==undefined && connection.isOpen;
    },
    /// get the connection used by `write` and `eval`, or return undefined
    getConnection : function() {
      return connection;
    },
    /// Return a promise with the connection used by `write` and `eval`, and if there's no connection attempt to get one
    getConnectionAsync : function() {
      return connection ? Promise.resolve(connection) : uart.connectAsync();
    },
    /// Close the connection used by `write` and `eval`
    close : function() {
      if (connection)
        connection.close();
    },
    /** Utility function to fade out everything on the webpage and display
    a window saying 'Click to continue'. When clicked it'll disappear and
    'callback' will be called. This is useful because you can't initialise
    Web Bluetooth unless you're doing so in response to a user input.*/
    modal : function(callback) {
      var menu = createModal({
        title : "Connection",
        contents : '<br/><center>Please click to connect</center>',
        onClickBackground : callback,
        onClickMenu : function() {
          menu.remove();
          callback();
        }
      });
    },
    /* This is the list of 'drivers' for Web Bluetooth/Web Serial. It's possible to add to these
    and also change 'ports' in order to add your own custom endpoints (eg WebSockets) */
    endpoints : endpoints,
    /* options passed to navigator.serial.requestPort. You can change this to:
      {filters:[{ usbVendorId: 0x1234 }]} to restrict the serial ports that are shown */
    optionsSerial : {},
    /* options passed to navigator.bluetooth.requestDevice. You can change this to
       allow more devices to connect (or restrict the ones that are shown) */
    optionsBluetooth : {
      filters:[
        { namePrefix: 'Puck.js' },
        { namePrefix: 'Pixl.js' },
        { namePrefix: 'Jolt.js' },
        { namePrefix: 'MDBT42Q' },
        { namePrefix: 'Bangle' },
        { namePrefix: 'RuuviTag' },
        { namePrefix: 'iTracker' },
        { namePrefix: 'Thingy' },
        { namePrefix: 'Espruino' },
        { services: [ NORDIC_SERVICE ] }
      ], optionalServices: [ NORDIC_SERVICE ]}
  };
  return uart;
}));
