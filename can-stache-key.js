var Observation = require('can-observation');
var dev = require('can-util/js/dev/dev');
var each = require('can-util/js/each/each');
var canSymbol = require("can-symbol");
var canReflect = require("can-reflect");
var isPromiseLike = require('can-util/js/is-promise-like/is-promise-like');
var canReflectPromise = require("can-reflect-promise");

var getValueSymbol = canSymbol.for("can.getValue");
var setValueSymbol = canSymbol.for("can.setValue");

var isValueLikeSymbol = canSymbol.for("can.isValueLike");
var observeReader;
var isAt = function(index, reads) {
	var prevRead = reads[index-1];
	return prevRead && prevRead.at;
};

var readValue = function(value, index, reads, options, state, prev){
	// if the previous read is AT false ... we shouldn't be doing this;
	var usedValueReader;
	do {

		usedValueReader = false;
		for(var i =0, len = observeReader.valueReaders.length; i < len; i++){
			if( observeReader.valueReaders[i].test(value, index, reads, options) ) {
				value = observeReader.valueReaders[i].read(value, index, reads, options, state, prev);
				//usedValueReader = true;
			}
		}
	} while(usedValueReader);

	return value;
};

var specialRead = {index: true, key: true, event: true, element: true, viewModel: true};

var checkForObservableAndNotify = function(options, state, getObserves, value, index){
	if(options.foundObservable && !state.foundObservable) {
		if(Observation.trapsCount()) {
			Observation.addAll( getObserves() );
			options.foundObservable(value, index);
			state.foundObservable = true;
		}
	}
};

observeReader = {
	// there are things that you need to evaluate when you get them back as a property read
	// for example a compute or a function you might need to call to get the next value to
	// actually check
	// - isArgument - should be renamed to something like "onLastPropertyReadReturnFunctionInsteadOfCallingIt".
	//   This is used to make a compute out of that function if necessary.
	// - readCompute - can be set to `false` to prevent reading an ending compute.  This is used by component to get a
	//   compute as a delegate.  In 3.0, this should be removed and force people to write "{@prop} change"
	// - callMethodsOnObservables - this is an overwrite ... so normal methods won't be called, but observable ones will.
	// - executeAnonymousFunctions - call a function if it's found, defaults to true
	// - proxyMethods - if the last read is a method, return a function so `this` will be correct.
	// - args - arguments to call functions with.
	//
	// Callbacks
	// - earlyExit - called if a value could not be found
	// - foundObservable - called when an observable value is found
	read: function (parent, reads, options) {
		options = options || {};
		var state = {
			foundObservable: false
		};
		var getObserves;
		if(options.foundObservable) {
			getObserves = Observation.trap();
		}

		// `cur` is the current value.
		var cur = readValue(parent, 0, reads, options, state),
			type,
			// `prev` is the object we are reading from.
			prev,
			// `foundObs` did we find an observable.
			readLength = reads.length,
			i = 0,
			last;

		checkForObservableAndNotify(options, state, getObserves, parent, 0);

		while( i < readLength ) {
			prev = cur;
			// try to read the property
			for(var r=0, readersLength = observeReader.propertyReaders.length; r < readersLength; r++) {
				var reader = observeReader.propertyReaders[r];
				if(reader.test(cur)) {
					cur = reader.read(cur, reads[i], i, options, state);
					break; // there can be only one reading of a property
				}
			}
			checkForObservableAndNotify(options, state, getObserves, prev, i);
			last = cur;
			i = i+1;
			// read the value if it is a compute or function
			cur = readValue(cur, i, reads, options, state, prev);

			checkForObservableAndNotify(options, state, getObserves, prev, i-1);



			type = typeof cur;
			// early exit if need be
			if (i < reads.length && (cur === null || cur === undefined )) {
				if (options.earlyExit) {
					options.earlyExit(prev, i - 1, cur);
				}
				// return undefined so we know this isn't the right value
				return {
					value: undefined,
					parent: prev
				};
			}

		}
		// if we don't have a value, exit early.
		if (cur === undefined) {
			if (options.earlyExit) {
				options.earlyExit(prev, i - 1);
			}
		}
		return {
			value: cur,
			parent: prev
		};
	},
	get: function(parent, reads, options){
		return observeReader.read(parent, observeReader.reads(reads), options || {}).value;
	},
	valueReadersMap: {},
	// an array of types that might have a value inside them like functions
	// value readers check the current value
	// and get a new value from it
	// ideally they would keep calling until
	// none of these passed
	valueReaders: [
		{
			name: "function",
			// if this is a function before the last read and its not a constructor function
			test: function(value){
				return value && canReflect.isFunctionLike(value) && !canReflect.isConstructorLike(value);
			},
			read: function(value, i, reads, options, state, prev){
				if( isAt(i, reads) ) {
					return i === reads.length ? value.bind(prev) : value;
				}
				else if(options.callMethodsOnObservables && canReflect.isObservableLike(prev) && canReflect.isMapLike(prev)) {
					return value.apply(prev, options.args || []);
				}
				else if ( options.isArgument && i === reads.length ) {
					return options.proxyMethods !== false ? value.bind(prev) : value;
				}
				return value.apply(prev, options.args || []);
			}
		},
		{
			name: "isValueLike",
			// compute value reader
			test: function(value, i, reads, options) {
				return value && value[getValueSymbol] && value[isValueLikeSymbol] !== false && (options.foundAt || !isAt(i, reads) );
			},
			read: function(value, i, reads, options){
				if(options.readCompute === false && i === reads.length ) {
					return value;
				}
				return canReflect.getValue(value);
			},
			write: function(base, newVal){
				if(base[setValueSymbol]) {
					base[setValueSymbol](newVal);
				} else if(base.set) {
					base.set(newVal);
				} else {
					base(newVal);
				}
			}
		}],
	propertyReadersMap: {},
	// an array of things that might have a property
	propertyReaders: [
		{
			name: "map",
			test: function(value){
				// the first time we try reading from a promise, set it up for
				//  special reflections.
				if(isPromiseLike(value) || typeof value === "object" && value !== null && typeof value.then === "function") {
					canReflectPromise(value);
				}

				return canReflect.isObservableLike(value) && canReflect.isMapLike(value);
			},
			read: function(value, prop){
				var res = canReflect.getKeyValue(value, prop.key);
				if(res !== undefined) {
					return res;
				} else {
					return value[prop.key];
				}
			},
			write: canReflect.setKeyValue
		},

		// read a normal object
		{
			name: "object",
			// this is the default
			test: function(){return true;},
			read: function(value, prop, i, options){
				if(value == null) {
					return undefined;
				} else {
					if(typeof value === "object") {
						if(prop.key in value) {
							return value[prop.key];
						}
						// TODO: remove in 3.0.  This is for backwards compat with @key and @index.
						else if( prop.at && specialRead[prop.key] && ( ("@"+prop.key) in value)) {
							options.foundAt = true;
							//!steal-remove-start
							dev.warn("Use %"+prop.key+" in place of @"+prop.key+".");

							//!steal-remove-end

							return value["@"+prop.key];
						}
					} else {
						return value[prop.key];
					}
				}
			},
			write: function(base, prop, newVal){
				base[prop] = newVal;
			}
		}
	],
	reads: function(keyArg) {
		var key = ""+keyArg;
		var keys = [];
		var last = 0;
		var at = false;
		if( key.charAt(0) === "@" ) {
			last = 1;
			at = true;
		}
		var keyToAdd = "";
		for(var i = last; i < key.length; i++) {
			var character = key.charAt(i);
			if(character === "." || character === "@") {
				if( key.charAt(i -1) !== "\\" ) {
					keys.push({
						key: keyToAdd,
						at: at
					});
					at = character === "@";
					keyToAdd = "";
				} else {
					keyToAdd = keyToAdd.substr(0,keyToAdd.length - 1) + ".";
				}
			} else {
				keyToAdd += character;
			}
		}
		keys.push({
			key: keyToAdd,
			at: at
		});

		return keys;
	},
	// This should be able to set a property similar to how read works.
	write: function(parent, key, value, options) {
		var keys = typeof key === "string" ? observeReader.reads(key) : key;
		var last;

		options = options || {};

		if(keys.length > 1) {
			last = keys.pop();
			parent = observeReader.read(parent, keys, options).value;
			keys.push(last);
		} else {
			last = keys[0];
		}
		// here's where we need to figure out the best way to write

		// if property being set points at a compute, set the compute
		if( observeReader.valueReadersMap.isValueLike.test(parent[last.key], keys.length - 1, keys, options) ) {
			observeReader.valueReadersMap.isValueLike.write(parent[last.key], value, options);
		} else {
			if(observeReader.valueReadersMap.isValueLike.test(parent, keys.length - 1, keys, options) ) {
				parent = parent[getValueSymbol]();
			}
			if(observeReader.propertyReadersMap.map.test(parent)) {
				observeReader.propertyReadersMap.map.write(parent, last.key, value, options);
			}
			else if(observeReader.propertyReadersMap.object.test(parent)) {
				observeReader.propertyReadersMap.object.write(parent, last.key, value, options);
				if(options.observation) {
					options.observation.update();
				}
			}
		}
	}
};
each(observeReader.propertyReaders, function(reader){
	observeReader.propertyReadersMap[reader.name] = reader;
});
each(observeReader.valueReaders, function(reader){
	observeReader.valueReadersMap[reader.name] = reader;
});
observeReader.set = observeReader.write;

module.exports = observeReader;
