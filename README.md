EspruinoWebTools
================

Tools/utilities for accessing Espruino devices from websites.

## uart.js

Super-simple library for accessing Bluetooth LE, Serial and USB
Espruino devices straight from the web browser.

```
UART.write('LED1.set();\n');
```

[try it out](examples/uart.html)

## imageconverter.js

Library to help converting images into a format suitable for Espruino.

```
var img = document.getElementById("image");
var jscode = imageconverter.imagetoString(img, {mode:"1bit", diffusion:"error"});
```

[try it out](examples/imageconverter.html)
or [simple version](examples/imageconverter.html)

## heatshrink.js

JavaScript port of the [heatshrink library](https://github.com/atomicobject/heatshrink)
for use with the heatshrink compression library inside Espruino.

```
var data = new Uint8Array(...);;
var compressed = heatshrink.compress(data);
data = heatshrink.decompress(compressed);
```

## puck.js

Super-simple library for accessing Bluetooth LE. It's recommended
you use `uart.js` now as it supports more communication types.

```
Puck.write('LED1.set();\n');
```

[try it out](examples/puck.html)
