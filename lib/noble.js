var debug = require('debug')('noble');

var events = require('events');
var os = require('os');
var util = require('util');

var Peripheral = require('./peripheral');
var Service = require('./service');
var Characteristic = require('./characteristic');
var Descriptor = require('./descriptor');

var bindings = null;

var platform = os.platform();

if (process.env.NOBLE_WEBSOCKET || process.title === 'browser') {
  bindings = require('./websocket/bindings');
} else if (process.env.NOBLE_DISTRIBUTED) {
  bindings = require('./distributed/bindings');
} else if (platform === 'darwin') {
  bindings = require('./mac/bindings');
} else if (platform === 'linux' || platform === 'win32') {
  bindings = require('./hci-socket/bindings');
} else {
  throw new Error('Unsupported platform');
}

function Noble() {
  this.state = 'unknown';
  this.address = 'unknown';

  this._bindings = bindings;
  this._peripherals = {};
  this._services = {};
  this._characteristics = {};
  this._descriptors = {};
  this._discoveredPeripheralUUids = [];

  this._bindings.on('stateChange', this.onStateChange.bind(this));
  this._bindings.on('addressChange', this.onAddressChange.bind(this));
  this._bindings.on('scanStart', this.onScanStart.bind(this));
  this._bindings.on('scanStop', this.onScanStop.bind(this));
  this._bindings.on('scanParametersSet', this.onScanParametersSet.bind(this));
  this._bindings.on('discover', this.onDiscover.bind(this));
  this._bindings.on('connect', this.onConnect.bind(this));
  this._bindings.on('disconnect', this.onDisconnect.bind(this));
  this._bindings.on('rssiUpdate', this.onRssiUpdate.bind(this));
  this._bindings.on('servicesDiscover', this.onServicesDiscover.bind(this));
  this._bindings.on('includedServicesDiscover', this.onIncludedServicesDiscover.bind(this));
  this._bindings.on('characteristicsDiscover', this.onCharacteristicsDiscover.bind(this));
  this._bindings.on('read', this.onRead.bind(this));
  this._bindings.on('readDesc', this.onReadDesc.bind(this));
  this._bindings.on('write', this.onWrite.bind(this));
  this._bindings.on('broadcast', this.onBroadcast.bind(this));
  this._bindings.on('notify', this.onNotify.bind(this));
  this._bindings.on('descriptorsDiscover', this.onDescriptorsDiscover.bind(this));
  this._bindings.on('valueRead', this.onValueRead.bind(this));
  this._bindings.on('valueWrite', this.onValueWrite.bind(this));
  this._bindings.on('handleRead', this.onHandleRead.bind(this));
  this._bindings.on('handleWrite', this.onHandleWrite.bind(this));
  this._bindings.on('handleNotify', this.onHandleNotify.bind(this));
  this._bindings.on('connUpdateComplete', this.onConnUpdateComplete.bind(this));

  this.on('warning', function(message) {
    if (this.listeners('warning').length === 1) {
      console.warn('noble: ' + message);
    }
  }.bind(this));
}

util.inherits(Noble, events.EventEmitter);

Noble.prototype.init = function () {
  this._bindings.init();
};

Noble.prototype.close = function () {
  this._bindings.close();
};

Noble.prototype.onStateChange = function(state) {
  debug('stateChange ' + state);

  this.state = state;

  this.emit('stateChange', state);
};

Noble.prototype.onAddressChange = function(address) {
  debug('addressChange ' + address);

  this.address = address;
};

Noble.prototype.startScanning = function(serviceUuids, allowDuplicates, callback) {
  if (this.state !== 'poweredOn') {
    var error = new Error('Could not start scanning, state is ' + this.state + ' (not poweredOn)');

    if (typeof callback === 'function') {
      callback(error);
    } else {
      throw error;
    }
  } else {
    if (callback) {
      this.once('scanStart', callback);
    }

    this._discoveredPeripheralUUids = [];
    this._allowDuplicates = allowDuplicates;

    this._bindings.startScanning(serviceUuids, allowDuplicates);
  }
};

Noble.prototype.onScanStart = function() {
  debug('scanStart');
  this.emit('scanStart');
};

Noble.prototype.stopScanning = function(callback) {
  if (callback) {
    this.once('scanStop', callback);
  }
  this._bindings.stopScanning();
};

Noble.prototype.onScanStop = function() {
  debug('scanStop');
  this.emit('scanStop');
};

Noble.prototype.onDiscover = function(uuid, address, addressType, connectable, advertisement, rssi) {
  var peripheral = this._peripherals[uuid];

  if (!peripheral) {
    peripheral = new Peripheral(this, uuid, address, addressType, connectable, advertisement, rssi);

    this._peripherals[uuid] = peripheral;
    this._services[uuid] = {};
    this._characteristics[uuid] = {};
    this._descriptors[uuid] = {};
  } else {
    // "or" the advertisment data with existing
    for (var i in advertisement) {
      if (advertisement[i] !== undefined) {
        peripheral.advertisement[i] = advertisement[i];
      }
    }

    peripheral.rssi = rssi;
  }

  var previouslyDiscoverd = (this._discoveredPeripheralUUids.indexOf(uuid) !== -1);

  if (!previouslyDiscoverd) {
    this._discoveredPeripheralUUids.push(uuid);
  }

  if (this._allowDuplicates || !previouslyDiscoverd) {
    this.emit('discover', peripheral);
  }
};

Noble.prototype.setScanParameters = function(interval, window, callback) {
  if (callback) {
    this.once('scanParametersSet', callback);
  }
  this._bindings.setScanParameters(interval, window);
};

Noble.prototype.onScanParametersSet = function() {
  debug('scanParametersSet');
  this.emit('scanParametersSet');
};

Noble.prototype.connect = function(peripheralUuid) {
  this._bindings.connect(peripheralUuid);
};

Noble.prototype.connectCancel = function(peripheralUuid) {
  this._bindings.connectCalcel(peripheralUuid);
};

Noble.prototype.onConnect = function(peripheralUuid, error) {
  var peripheral = this._peripherals[peripheralUuid];

  if (peripheral) {
    peripheral.state = error ? 'error' : 'connected';
    peripheral.emit('connect', error);
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ' connected!');
  }
};

Noble.prototype.disconnect = function(peripheralUuid) {
  this._bindings.disconnect(peripheralUuid);
};

Noble.prototype.onDisconnect = function(peripheralUuid) {
  var peripheral = this._peripherals[peripheralUuid];

  if (peripheral) {
    peripheral.state = 'disconnected';
    peripheral.emit('disconnect');
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ' disconnected!');
  }
};

Noble.prototype.setConnParameters = function(interval, latency, timeout) {
  this._bindings.setConnParameters(interval, latency, timeout);
};

Noble.prototype.updateRssi = function(peripheralUuid) {
  this._bindings.updateRssi(peripheralUuid);
};

Noble.prototype.onRssiUpdate = function(peripheralUuid, rssi) {
  var peripheral = this._peripherals[peripheralUuid];

  if (peripheral) {
    peripheral.rssi = rssi;

    peripheral.emit('rssiUpdate', rssi);
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ' RSSI update!');
  }
};

Noble.prototype.updateConnParameters = function(peripheralUuid, interval, latency, timeout) {
  this._bindings.updateConnParameters(peripheralUuid, interval, latency, timeout);
};

Noble.prototype.onConnUpdateComplete = function(peripheralUuid, interval, latency, timeout) {
  var peripheral = this._peripherals[peripheralUuid];

  if (peripheral) {
    peripheral.emit('connUpdateComplete', interval, latency, timeout);
    peripheral.linkParams = {
      interval: interval, 
      latency: latency,
      timeout: timeout
    };
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ' connection parameters update!');
  }
};

Noble.prototype.discoverServices = function(peripheralUuid, uuids) {
  this._bindings.discoverServices(peripheralUuid, uuids);
};

Noble.prototype.onServicesDiscover = function(peripheralUuid, serviceUuids) {
  var peripheral = this._peripherals[peripheralUuid];

  if (peripheral) {
    var services = [];

    for (var i = 0; i < serviceUuids.length; i++) {
      var serviceUuid = serviceUuids[i];
      var service = new Service(this, peripheralUuid, serviceUuid);

      this._services[peripheralUuid][serviceUuid] = service;
      this._characteristics[peripheralUuid][serviceUuid] = {};
      this._descriptors[peripheralUuid][serviceUuid] = {};

      services.push(service);
    }

    peripheral.services = services;

    peripheral.emit('servicesDiscover', services);
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ' services discover!');
  }
};

Noble.prototype.discoverIncludedServices = function(peripheralUuid, serviceUuid, serviceUuids) {
  this._bindings.discoverIncludedServices(peripheralUuid, serviceUuid, serviceUuids);
};

Noble.prototype.onIncludedServicesDiscover = function(peripheralUuid, serviceUuid, includedServiceUuids) {
  var service = this._services[peripheralUuid][serviceUuid];

  if (service) {
    service.includedServiceUuids = includedServiceUuids;

    service.emit('includedServicesDiscover', includedServiceUuids);
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ', ' + serviceUuid + ' included services discover!');
  }
};

Noble.prototype.discoverCharacteristics = function(peripheralUuid, serviceUuid, characteristicUuids) {
  this._bindings.discoverCharacteristics(peripheralUuid, serviceUuid, characteristicUuids);
};

Noble.prototype.onCharacteristicsDiscover = function(peripheralUuid, serviceUuid, characteristics) {
  var service = this._services[peripheralUuid][serviceUuid];

  if (service) {
    var characteristics_ = [];

    for (var i = 0; i < characteristics.length; i++) {
      var characteristicUuid = characteristics[i].uuid;

      var characteristic = new Characteristic(
                                this,
                                peripheralUuid,
                                serviceUuid,
                                characteristicUuid,
                                characteristics[i].handle, 
                                characteristics[i].properties,
                                characteristics[i].value
                            );

      var charLocation = this._characteristics[peripheralUuid][serviceUuid][characteristicUuid];

      if (charLocation) {
        if (!Array.isArray(charLocation)) {
          var charList = [];
          charList.push(charLocation);
          this._characteristics[peripheralUuid][serviceUuid][characteristicUuid] = charList;
        }

        this._characteristics[peripheralUuid][serviceUuid][characteristicUuid].push(characteristic);
      } else {
        this._characteristics[peripheralUuid][serviceUuid][characteristicUuid] = characteristic;
      }
      this._descriptors[peripheralUuid][serviceUuid][characteristicUuid] = {};

      characteristics_.push(characteristic);
    }

    service.characteristics = characteristics_;

    service.emit('characteristicsDiscover', characteristics_);
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ', ' + serviceUuid + ' characteristics discover!');
  }
};

Noble.prototype.read = function(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle) {
   this._bindings.read(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle);
};

Noble.prototype.onRead = function(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle, data, isNotification) {
  var characteristic = this.findChar(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle);

  if (characteristic) {
    characteristic.emit('data', data, isNotification);

    characteristic.emit('read', data, isNotification); // for backwards compatbility
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ', ' + serviceUuid + ', ' + characteristicUuid + ' read!');
  }
};

Noble.prototype.readDesc = function(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle) {
   this._bindings.readDesc(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle);
};

Noble.prototype.onReadDesc = function(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle, data) {
  var characteristic = this.findChar(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle);

  if (characteristic) {
    characteristic.emit('readDesc', data); // for backwards compatbility
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ', ' + serviceUuid + ', ' + characteristicUuid + ' read!');
  }
};

Noble.prototype.write = function(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle, data, withoutResponse) {
   this._bindings.write(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle, data, withoutResponse);
};

Noble.prototype.onWrite = function(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle) {
  var characteristic = this.findChar(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle);

  if (characteristic) {
    characteristic.emit('write');
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ', ' + serviceUuid + ', ' + characteristicUuid + ' write!');
  }
};

Noble.prototype.broadcast = function(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle, broadcast) {
   this._bindings.broadcast(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle, broadcast);
};

Noble.prototype.onBroadcast = function(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle, state) {
  var characteristic = this.findChar(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle);

  if (characteristic) {
    characteristic.emit('broadcast', state);
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ', ' + serviceUuid + ', ' + characteristicUuid + ' broadcast!');
  }
};

Noble.prototype.notify = function(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle, notify) {
   this._bindings.notify(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle, notify);
};

Noble.prototype.onNotify = function(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle, state) {
  var characteristic = this.findChar(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle);

  if (characteristic) {
    characteristic.emit('notify', state);
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ', ' + serviceUuid + ', ' + characteristicUuid + ' notify!');
  }
};

Noble.prototype.discoverDescriptors = function(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle) {
  this._bindings.discoverDescriptors(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle);
};

Noble.prototype.onDescriptorsDiscover = function(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle, descriptors) {
  var characteristic = this.findChar(peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle);

  if (characteristic) {
    var descriptors_ = [];

    for (var i = 0; i < descriptors.length; i++) {
      var descriptorUuid = descriptors[i];

      var descriptor = new Descriptor(
                            this,
                            peripheralUuid,
                            serviceUuid,
                            characteristicUuid,
                            descriptorUuid
                        );

      this._descriptors[peripheralUuid][serviceUuid][characteristicUuid][descriptorUuid] = descriptor;

      descriptors_.push(descriptor);
    }

    characteristic.descriptors = descriptors_;

    characteristic.emit('descriptorsDiscover', descriptors_);
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ', ' + serviceUuid + ', ' + characteristicUuid + ' descriptors discover!');
  }
};

Noble.prototype.readValue = function(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid) {
  this._bindings.readValue(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid);
};

Noble.prototype.onValueRead = function(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, data) {
  var descriptor = this._descriptors[peripheralUuid][serviceUuid][characteristicUuid][descriptorUuid];

  if (descriptor) {
    descriptor.emit('valueRead', data);
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ', ' + serviceUuid + ', ' + characteristicUuid + ', ' + descriptorUuid + ' value read!');
  }
};

Noble.prototype.writeValue = function(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, data) {
  this._bindings.writeValue(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid, data);
};

Noble.prototype.onValueWrite = function(peripheralUuid, serviceUuid, characteristicUuid, descriptorUuid) {
  var descriptor = this._descriptors[peripheralUuid][serviceUuid][characteristicUuid][descriptorUuid];

  if (descriptor) {
    descriptor.emit('valueWrite');
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ', ' + serviceUuid + ', ' + characteristicUuid + ', ' + descriptorUuid + ' value write!');
  }
};

Noble.prototype.readHandle = function(peripheralUuid, handle) {
  this._bindings.readHandle(peripheralUuid, handle);
};

Noble.prototype.onHandleRead = function(peripheralUuid, handle, data) {
  var peripheral = this._peripherals[peripheralUuid];

  if (peripheral) {
    peripheral.emit('handleRead' + handle, data);
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ' handle read!');
  }
};

Noble.prototype.writeHandle = function(peripheralUuid, handle, data, withoutResponse) {
  this._bindings.writeHandle(peripheralUuid, handle, data, withoutResponse);
};

Noble.prototype.onHandleWrite = function(peripheralUuid, handle) {
  var peripheral = this._peripherals[peripheralUuid];

  if (peripheral) {
    peripheral.emit('handleWrite' + handle);
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ' handle write!');
  }
};

Noble.prototype.onHandleNotify = function(peripheralUuid, handle, data) {
  var peripheral = this._peripherals[peripheralUuid];

  if (peripheral) {
    peripheral.emit('handleNotify', handle, data);
  } else {
    this.emit('warning', 'unknown peripheral ' + peripheralUuid + ' handle notify!');
  }
};

Noble.prototype.findChar = function (peripheralUuid, serviceUuid, characteristicUuid, characteristicHandle) {
  var characteristic = this._characteristics[peripheralUuid][serviceUuid][characteristicUuid];

  if (Array.isArray(characteristic))
    characteristic.forEach(function (char) {
      if (char.handle === characteristicHandle)
        characteristic = char;
    });

  return characteristic;
};

module.exports = Noble;
