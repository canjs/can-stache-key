var observeReader = require("can-stache-key");
var QUnit = require('steal-qunit');
var Observation = require('can-observation');
var eventQueue = require('can-event-queue/map/legacy/legacy');
var SimpleObservable = require("can-simple-observable");
var testHelpers = require('can-test-helpers');

var SimpleMap = require("can-simple-map");
var canReflect = require("can-reflect");

QUnit.module('can-stache-key',{

});

test("can read a promise (#179)", function(){
	var data = {
		promise: new Promise(function(resolve){
			setTimeout(function(){
				resolve("Something");
			},2);
		})
	};
	var calls = 0;
	var c = new Observation(function(){
		return observeReader.read(data,observeReader.reads("promise.value")).value;
	});
	canReflect.onValue(c, function(newVal, oldVal){
		calls++;
		equal(calls, 1, "only one call");
		equal(newVal, "Something", "new value");
		equal(oldVal, undefined, "oldVal");
		start();
	});

	stop();

});

test("can.Compute.read can read a promise-like (#82)", function(){
	var data = {
		promiseLike: {
			then: function(resolve) {
				setTimeout(function(){
					resolve("Something");
				}, 2);
			}
		}
	};
	var calls = 0;
	var c = new Observation(function(){
		return observeReader.read(data,observeReader.reads("promiseLike.value")).value;
	});
	canReflect.onValue(c, function(newVal, oldVal){
		calls++;
		equal(calls, 1, "only one call");
		equal(newVal, "Something", "new value");
		equal(oldVal, undefined, "oldVal");
		start();
	});

	stop();

});

test('can.compute.reads', function(){
	deepEqual( observeReader.reads("@foo"),
		[{key: "foo", at: true}]);

	deepEqual( observeReader.reads("@foo.bar"),
		[{key: "foo", at: true}, {key: "bar", at: false}]);

	deepEqual( observeReader.reads("@foo\\.bar"),
		[{key: "foo.bar", at: true}]);

	deepEqual( observeReader.reads("foo.bar@zed"),
		[{key: "foo", at: false},{key: "bar", at: false},{key: "zed", at: true}]);

});

test('able to read things like can-define', 3, function(){
	var obj = eventQueue({});
	var prop = "PROP";
	Object.defineProperty(obj, "prop",{
		get: function(){
			Observation.add(obj,"prop");
			return prop;
		},
		set: function(val){
			var old = prop;
			prop = val;
			this.dispatch("prop", prop, old);
		}
	});
	var data = {
		obj: obj
	};

	var c = new Observation(function(){
		var value = observeReader.read(data,observeReader.reads("obj.prop"),{
			foundObservable: function(obs, index){
				equal(obs, obj, "got an observable");
				equal(index,1, "got the right index");
			}
		}).value;
		equal(value, "PROP");
	});
	canReflect.onValue(c, function(){});
});

test("foundObservable called with observable object (#7)", function(){
	var map = new SimpleMap({
		isSaving: function(){
			Observation.add(this, "_saving");
		},
		addEventListener: function(){}
	});

	// must use an observation to make sure things are listening.
	var c = new Observation(function(){
		observeReader.read(map,observeReader.reads("isSaving"),{
			foundObservable: function(obs){
				QUnit.equal(obs, map);
			},
			callMethodsOnObservables: true
		});
	});
	canReflect.onValue(c, function(){});
});

test("can read from strings", function(){
	var context = " hi there ";

	var result =  observeReader.read(context,observeReader.reads("trim"),{});
	QUnit.ok(result, context.trim);
});

test("read / write to DefineMap", function(){
	var map = new SimpleMap();
	var c = new Observation(function(){
		var data = observeReader.read(map,observeReader.reads("value"),{
			foundObservable: function(obs){
				QUnit.equal(obs, map, "got map");
			}
		});
		return data.value;
	});
	canReflect.onValue(c, function(newVal){
		QUnit.equal(newVal, 1, "got updated");
	});
	observeReader.write(map,"value",1);
});

test("write deep in DefineMap", function(){
	var map = new SimpleMap();
	observeReader.write(map,"foo", new SimpleMap());
	observeReader.write(map,"foo.bar", 1);

	QUnit.equal(map.get("foo").get("bar"), 1, "value set");
});

test("write to compute in object", function(){
	var value = 2;
	var computeObject = {};
	canReflect.assignSymbols(computeObject, {
		"can.getValue": function(){
			return value;
		},
		"can.setValue": function(newVal){
			value = newVal;
		}
	});

	var obj = {compute: computeObject};

	observeReader.write(obj,"compute", 3);

	QUnit.equal(value, 3, "value set");
});

test("write to a map in a compute", function(){

	var map = new SimpleMap({complete: true});
	var computeObject = {};

	canReflect.assignSymbols(computeObject, {
		"can.getValue": function(){
			return map;
		},
		"can.setValue": function(newVal){
			map = newVal;
		}
	});

	observeReader.write(computeObject, "complete", false);

	QUnit.equal(map.attr("complete"), false, "value set");
});

QUnit.test("reads can be passed a number (can-stache#207)", function(){
	var reads = observeReader.reads(0);
	QUnit.deepEqual(reads, [{key: "0", at: false}], "number converted to string");

});

QUnit.test("can read primitive numbers (#88)", function(){
	var reads = observeReader.reads("num@toFixed");
	var toFixed = observeReader.read({
		num: 5
	}, reads, {}).value;

	QUnit.equal(typeof toFixed, "function", "got to fixed");

});

test("it returns null when promise getter is null #2", function(){
	var nullPromise = observeReader.read(null, observeReader.reads('value'));
	QUnit.equal(typeof nullPromise,"object");
});

QUnit.test("set onto observable objects and values", function(){
	var map = new SimpleMap();
	observeReader.write({map: map},"map", {a: "b"});

	QUnit.equal(map.get("a"), "b", "merged");


	var simple = new SimpleObservable();
	observeReader.write({simple: simple},"simple", 1);
	QUnit.equal(simple.get(), 1);
});

testHelpers.dev.devOnlyTest("functions are not called by read()", function() {
	var func = function() {
		QUnit.ok(false, "method called");
	};
	var data = { func: func };
	var reads = observeReader.reads("func");

	observeReader.read(data, reads);

	QUnit.ok(true);
});

testHelpers.dev.devOnlyTest("a warning is given for `callMethodsOnObservables: true`", function() {
	var teardown = testHelpers.dev.willWarn("can-stache-key: read() called with `callMethodsOnObservables: true`.");
	var func = function() {
		QUnit.ok(true, "method called");
	};
	var data = new SimpleMap({ func: func });
	var reads = observeReader.reads("func");

	observeReader.read(data, reads, {
		callMethodsOnObservables: true
	});

	QUnit.ok(teardown(), 1, "warning displayed");
});
