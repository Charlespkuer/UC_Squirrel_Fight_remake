var window = this;
window.localStorage = new Storage();
require("js/version.js");
window.versionId = versionAndroid;
console.log("window.versionId   ="+window.versionId);
var p = {};
p.clz = 'com.ucweb.utils.JsStaticVar';
p.method = 'setVersionid';
p.args = {};
p.args.sid = window.versionId;
var parseVersion = function(data,callback){
    if(data.errorCode == 0){
        if(parseInt(data.status) == 0){
            var urls = [];
            var urList = data.versions;
            if(urList.length == 0){
                callback(false);
                return;
            }
            for(var k in urList){
                var _url = urList[k].url;

				var fouse = urList[k].force;
				if(parseInt(fouse) == 1){
					
					var ob = {};
					ob.code = urList[k].code;
					ob.url  = _url;
					callback(ob);
					return;
				}
                urls.push({url:_url});
            }
            var ob = {};
            ob.urls = urls;
            callback(ob);
            return;
        }else{
        }
    }else{
    }
}
var loadJSFile = function(){
	require("js/ajax.min.js");
	require("js/uc.base-1.0.1.js");
	require("js/Matrix2D.js");
	require("js/Map.min.js");
	require("js/JsonLoader.js");
	require("js/vmGameBase.js");
	require("js/ssdz-pkg2.js");
	require("js/BitmapCache.js");
	require("js/drawable.js");
	require("js/animationStr.js");
	require("js/assets.js");
	require("js/asset2.js");
	require("js/ArrayUtil.js");
	require("js/GameDict.js");
	require("js/player.js");            
	require("js/FightStats.js");
	game.onReady();
}
native.call(function(result) {
    console.log('call result ' + result);
    native.startActivity(function(ret){
       console.log("http result ="+ret);
        parseVersion(JSON.parse(ret), function(r){
            jsessionId = null;
            if(r == false){
                loadJSFile();
            }else{
				if(r.code != undefined){
						var obj = {};
						obj.clz = 'com.ucweb.h5runtimeActivity';
						obj.method = 'checkNeedToUpdateClient';
						obj.args = {};
						obj.args.version = r.code;
						obj.args.url = r.url;
						native.call(function(result) {
							loadJSFile();
						}, JSON.stringify(obj));
				}else{
					 native.downloadRes(function(result){
						loadJSFile();
					 },JSON.stringify(r));
				}
            }
        });
    },"com.ucweb.game.CheckVersionActivity");
}, JSON.stringify(p));







