var debug = require('debug')('characteristic');

var events = require('events');
var util = require('util');

var characteristics = require('./characteristics.json');

function Characteristic(noble, peripheralId, serviceUuid, uuid, handle, properties, value) {
  this._noble = noble;
  this._peripheralId = peripheralId;
  this._serviceUuid = serviceUuid;

  this.uuid = uuid;
  this.handle = handle;
  this.name = null;
  this.type = null;
  this.properties = properties;
  this.descriptors = null;
  this.value = value || null;

  var characteristic = characteristics[uuid];
  if (characteristic) {
    this.name = characteristic.name;
    this.type = characteristic.type;
  }
}

util.inherits(Characteristic, events.EventEmitter);

Characteristic.prototype.toString = function() {
  return JSON.stringify({
    uuid: this.uuid,
    name: this.name,
    type: this.type,
    properties: this.properties
  });
};

Characteristic.prototype.read = function(callback) {
  if (callback) {
    this.once('read', function(data) {
      callback(null, data);
    });
  }

  this._noble.read(
    this._peripheralId,
    this._serviceUuid,
    this.uuid,
    this.handle
  );
};

Characteristic.prototype.readDesc = function(callback) {
  if (callback) {
    this.once('readDesc', function(data) {
      callback(null, data);
    });
  }

  this._noble.readDesc(
    this._peripheralId,
    this._serviceUuid,
    this.uuid,
    this.handle
  );
};

Characteristic.prototype.write = function(data, withoutResponse, callback) {
  if (process.title !== 'browser') {
    if (!(data instanceof Buffer)) {
      throw new Error('data must be a Buffer');
    }
  }

  if (callback) {
    this.once('write', function() {
      callback(null);
    });
  }

  this._noble.write(
    this._peripheralId,
    this._serviceUuid,
    this.uuid,
    this.handle,
    data,
    withoutResponse
  );
};

Characteristic.prototype.broadcast = function(broadcast, callback) {
  if (callback) {
    this.once('broadcast', function() {
      callback(null);
    });
  }

  this._noble.broadcast(
    this._peripheralId,
    this._serviceUuid,
    this.uuid,
    this.handle,
    broadcast
  );
};

Characteristic.prototype.notify = function(notify, callback) {
  if (callback) {
    this.once('notify', function() {
      callback(null);
    });
  }

  this._noble.notify(
    this._peripheralId,
    this._serviceUuid,
    this.uuid,
    this.handle,
    notify
  );
};

Characteristic.prototype.discoverDescriptors = function(callback) {
  if (callback) {
    this.once('descriptorsDiscover', function(descriptors) {
      callback(null, descriptors);
    });
  }

  this._noble.discoverDescriptors(
    this._peripheralId,
    this._serviceUuid,
    this.uuid,
    this.handle
  );
};

module.exports = Characteristic;
