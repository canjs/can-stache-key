var observeReader = require("can-stache-key");
var QUnit = require('steal-qunit');
var Observation = require('can-observation');
var canEvent = require('can-event');
var testHelpers = require('can-test-helpers');

var assign = require("can-util/js/assign/assign");
var eventAsync = require("can-event/async/async");
var SimpleMap = require("can-simple-map");
var canReflect = require("can-reflect");

QUnit.module('can-observation/reader',{
	setup: function(){
		eventAsync.sync();
	},
	teardown: function(){
		eventAsync.async();
	}
});

test("can.Compute.read can read a promise (#179)", function(){
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
	}, null, {
		updater: function(newVal, oldVal){
			calls++;
			equal(calls, 1, "only one call");
			equal(newVal, "Something", "new value");
			equal(oldVal, undefined, "oldVal");
			start();
		}
	});
	c.start();

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
	}, null, {
		updater: function(newVal, oldVal){
			calls++;
			equal(calls, 1, "only one call");
			equal(newVal, "Something", "new value");
			equal(oldVal, undefined, "oldVal");
			start();
		}
	});
	c.start();

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
	var obj = assign({}, canEvent);
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
	}, null, {
		updater: function(){

		}
	});
	c.start();


});

test("foundObservable called with observable object (#7)", function(){
	var map = {
		isSaving: function(){
			Observation.add(this, "_saving");
		},
		addEventListener: function(){}
	};

	// must use an observation to make sure things are listening.
	var c = new Observation(function(){
		observeReader.read(map,observeReader.reads("isSaving"),{
			foundObservable: function(obs){
				QUnit.equal(obs, map);
			}
		});
	}, null,{});
	c.start();

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
	}, null,function(newVal){
		QUnit.equal(newVal, 1, "got updated");
	});
	c.start();
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

testHelpers.dev.devOnlyTest("a warning is displayed when functions are called by read()", function() {
	var teardown = testHelpers.dev.willWarn(/"func" is being called as a function/);
	var func = function() {
		QUnit.ok(true, "method called");
	};
	var data = { func: func };
	var reads = observeReader.reads("func");

	observeReader.read(data, reads, {
		warnOnFunctionCall: "A Warning"
	});

	QUnit.equal(teardown(), 1, "warning displayed");
});

testHelpers.dev.devOnlyTest("a warning is displayed when methods on observables are called by read()", function() {
	var teardown = testHelpers.dev.willWarn(/"func" is being called as a function/);
	var func = function() {
		QUnit.ok(true, "method called");
	};
	var data = new SimpleMap({ func: func });
	var reads = observeReader.reads("func");

	observeReader.read(data, reads, {
		callMethodsOnObservables: true
	});

	QUnit.equal(teardown(), 1, "warning displayed");
});

testHelpers.dev.devOnlyTest("a warning is not displayed when functions are read but not called", function() {
	var teardown = testHelpers.dev.willWarn(/"func" is being called as a function/);
	var func = function() {
		QUnit.ok(false, "method called");
	};
	var data = new SimpleMap({ func: func });
	var reads = observeReader.reads("@func");

	observeReader.read(data, reads, {
		callMethodsOnObservables: true
	});

	QUnit.equal(teardown(), 0, "warning not displayed");
});

testHelpers.dev.devOnlyTest("a warning is not displayed when functions are read but not called due to proxyMethods=false (#15)", function() {
	var teardown = testHelpers.dev.willWarn(/"func" is being called as a function/);
	var func = function() {
		QUnit.ok(false, "method not called");
	};
	var data = new SimpleMap({ func: func });
	var reads = observeReader.reads("func");

	observeReader.read(data, reads, {
		isArgument: true,
		proxyMethods: false
	});

	QUnit.equal(teardown(), 0, "warning not displayed");
});
