# libsamplerate.js

This is a port of [libsamplerate] \(0.1.9) to pure JavaScript using [Emscripten] for use in a browser environment.

### Usage

A JavaScript wrapper is provided for the [Full API] \(not actually the _full_ API).

Be aware that a resampler object is stateful, therefore one and only one resampler should be used for one and only one stream of audio data.
Depending on the converter type, some audio is buffered internally and the
stream must be flushed to output all of it.

Quick example usage:
```javascript
var Resampler = require('libsamplerate.js')

var resampler = new Resampler({
  type: Resampler.Type.SINC_MEDIUM_QUALITY,
  ratio: 48000 / 41100, // output/input
  channels: 1,
  unsafe: false
});

// The resampler can be used directly
resampler.write(Buffer.from([0, 0, 0, 1, 0, 2]));
var result = resampler.read();
// or just like any other node stream
someRawInput.pipe(resampler).pipe(someOutputStream);

// Only required if unsafe is true and the stream will not end by itself
// resampler.destroy()
```
For detailed information, see `lib/resampler.js`.

### Building from source

Prebuilt libsamplerate binaries are available in `build/`.
Building these yourself is rather simple (assuming you have common build tools already installed):

1. [Install Emscripten]
2. Run `make clean`
3. Run `make`

### License

The full license texts are available in `LICENSE.md`.

libsamplerate.js uses the MIT license while libsamplerate uses the 2-clause BSD license.

[libsamplerate]: http://www.mega-nerd.com/SRC/
[Full API]: http://www.mega-nerd.com/SRC/api_full.html
[Emscripten]: http://emscripten.org/
[Install Emscripten]: http://kripken.github.io/emscripten-site/docs/getting_started/downloads.html
