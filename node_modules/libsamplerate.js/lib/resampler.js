/* eslint-disable camelcase */ // To allow for p_name style pointer variables

var lib = require('../build/libsamplerate.js')
var util = require('util')
var extend = require('extend')
var Transform = require('stream').Transform
var e = function (msg) { return new Error(msg) }

var Type = {
  SINC_BEST_QUALITY: 0,
  SINC_MEDIUM_QUALITY: 1,
  SINC_FASTEST: 2,
  ZERO_ORDER_HOLD: 3,
  LINEAR: 4
}

/**
 * @typedef {Object} Data
 * @property {number} [ratio] - Conversion ratio for this batch of data
 * @property {Buffer} data - Buffer of data
 */

/**
 * Transform stream that resamples raw PCM audio samples in the Float32 format.
 * When in object mode, {@link Data}-like objects or Buffers are expected.
 * This transformer will always output Buffers.
 * For all audio to be processed, this stream has to be closed when finished.
 *
 * @param {object} [opts={}] - Options for the resampler
 * @param {Type} opts.type - Converter type
 * @param {number} opts.ratio - Default conversion ratio (output/input)
 * @param {number} [opts.channels=1] - Number of (interleaved) channels
 * @param {boolean} [opts.unsafe=false] - Mark this resampler as unsafe.<br>
 *    Resamplers in unsafe mode generally operate faster and use less memory.<br>
 *    Warning: {@link #destroy()} MUST be called on an unsafe resampler before
 *    it is garbage collected. Otherwise it will leak memory. It is called
 *    automatically if the underlying transform stream ends ('end' event).
 * @constructor
 */
function Resampler (opts) {
  // Allow use without new
  if (!(this instanceof Resampler)) return new Resampler(opts)

  Transform.call(this, {})

  opts = extend({
    type: Type.SINC_MEDIUM_QUALITY,
    ratio: 1,
    channels: 1,
    unsafe: false
  }, opts)

  if (opts.channels < 1) {
    throw e('channels must be greater than 1')
  }

  if (typeof opts.type !== 'number' || opts.type < 0 || opts.type > 4) {
    throw new TypeError('opts.type must be a number in [0, 4]')
  }

  if (typeof opts.ratio !== 'number' || opts.ratio <= 0) {
    throw new TypeError('opts.ratio must be a positive number')
  }

  this._type = opts.type
  this._ratio = opts.ratio
  this._channels = opts.channels
  this._unsafe = opts.unsafe

  this._inputBufferUsed = 0
  this._inputBufferSize = 0
  this._inputBuffer = 0

  if (this._unsafe) {
    // In unsafe mode, the global libsamplerate instance is used
    this._lib = lib.instance
    this.on('end', this.destroy.bind(this))
  } else {
    // In normal mode, every resampler gets its own instance of the lib
    this._lib = lib()
  }

  // Create SRC state
  var p_err = this._lib._malloc(4)
  try {
    this._state = this._lib._src_new(this._type, this._channels, p_err)
    if (this._state === 0) {
      throw this._error(p_err)
    }
  } finally {
    this._lib._free(p_err)
  }
}
util.inherits(Resampler, Transform)

/**
 * Handles an error returned by SRC.
 *
 * @param {number} p_err - Pointer to the error code
 * @returns {Error} A new Error object ready to be thrown
 */
Resampler.prototype._error = function (p_err) {
  var err = this._lib.HEAPU32[p_err >> 2]
  var str = this._lib._src_strerror(err)
  if (str === 0) {
    return new Error('unknown error')
  } else {
    return new Error(this._lib.Pointer_stringify(str))
  }
}

/**
 * Destroy this resampler.
 * This method should only be called if this resampler is in unsafe mode.
 * Any subsequent resampling will result in undefined behavior.
 */
Resampler.prototype.destroy = function () {
  if (this._unsafe && this._lib) {
    this._lib._free(this._inputBuffer)
    this._state = this._lib._src_delete(this._state)
    this._lib = null
  }
}

Resampler.prototype._addInput = function (buf) {
  var HEAPU8 = this._lib.HEAPU8

  // Dynamically resize input buffer if too small
  if (buf.length + this._inputBufferUsed > this._inputBufferSize) {
    this._inputBufferSize = buf.length + this._inputBufferUsed
    // Create new buffer
    var newBuffer = this._lib._malloc(this._inputBufferSize)
    // Copy old data to new buffer
    HEAPU8.set(HEAPU8.subarray(this._inputBuffer,
      this._inputBuffer + this._inputBufferUsed), newBuffer)
    // Replace old buffer
    this._lib._free(this._inputBuffer)
    this._inputBuffer = newBuffer
  }

  // Copy new data to input buffer
  HEAPU8.set(buf, this._inputBuffer + this._inputBufferUsed)
  this._inputBufferUsed += buf.length
}

Resampler.prototype._transform = function (chunk, encoding, callback) {
  try {
    this._process(chunk, false)
  } catch (err) {
    return callback(err)
  }
  callback(null)
}

Resampler.prototype._flush = function (callback) {
  try {
    this._process(Buffer.alloc(0), true)
  } catch (err) {
    return callback(err)
  }
  callback(null)
}

Resampler.prototype._process = function (chunk, end) {
  var ratio = this._ratio
  // Handle object mode
  if (!(chunk instanceof Buffer)) {
    if (!chunk.data || !(chunk.data instanceof Buffer)) {
      throw new TypeError('chunk does not have a data property')
    }
    if (chunk.ratio) {
      ratio = chunk.ratio
    }
    chunk = chunk.data
  }

  this._addInput(chunk)

  // Prepare data struct
  var outputFrames = 1 << 20 // Arbitrary value
  var p_data_out = this._lib._malloc(outputFrames * 4 * this._channels)
  var p_data = this._lib._malloc(40)
  this._lib.HEAP32[(p_data + 4) >> 2] = p_data_out
  this._lib.HEAP32[(p_data + 12) >> 2] = outputFrames
  this._lib.HEAP32[(p_data + 24) >> 2] = 0
  this._lib.HEAPF64[(p_data + 32) >> 3] = ratio

  var inputBufferOffset = 0
  while (true) {
    // Set input pointer
    this._lib.HEAP32[(p_data + 0) >> 2] =
      this._inputBuffer + inputBufferOffset
    // Set input length
    this._lib.HEAP32[(p_data + 8) >> 2] =
      (this._inputBufferUsed - inputBufferOffset) / 4 / this._channels

    // Start processing
    var err = this._lib._src_process(this._state, p_data)
    if (err) {
      throw this._error(err)
    }

    // Read used input frames
    inputBufferOffset += this._lib.HEAP32[(p_data + 16) >> 2] * 4 * this._channels
    // Read generated output frames
    var len = this._lib.HEAP32[(p_data + 20) >> 2] * 4 * this._channels
    if (len > 0) {
      this.push(Buffer.from(this._lib.HEAPU8.slice(p_data_out, p_data_out + len)))
    } else {
      // Remove used samples from the input buffer
      var inputBuffer = this._lib.HEAPU8.subarray(this._inputBuffer,
        this._inputBuffer + this._inputBufferUsed)
      inputBuffer.copyWithin(0, inputBufferOffset)
      this._inputBufferUsed -= inputBufferOffset
      break
    }
  }
  this._lib._free(p_data_out)
  this._lib._free(p_data)
}

Resampler.Type = Type
module.exports = Resampler
