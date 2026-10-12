/**
 * 加速引擎专用代码
 * game.js
 */

(function () {
    var fps, viewport, popDiv, currentState,lastState,frames = 0;
    var fpsText;
    var game = function () {
        throw("game是一个单例");
    }
    game.onReady = function(){
        gameInit();
    }
    //公有静态变量
    game.isDev = false;
    game.state = null;
    game.eventManager = null;
    game.loadArr = [];
	game.loadArr2 = [];
    game.scale = 1;
    game.urlAdress = "http://ssdz.u.uc.cn/FightGame";
	game.audio_switch = true;
	//http://ssdz.u.uc.cn/FightGame   正式
	//http://115.238.230.18:18043/FightGame 测试
	//http://192.168.105.21:8091/FightGame/ 本地
	//http://192.168.105.21:8091/FightGame
		//http://192.168.105.21:8091/FightGame"http://115.238.230.18:18043/FightGame""http://115.238.230.18:18043/FightGame";
    //"http://115.238.230.18:18043/FightGame";//"http://192.168.101.109:8091/FightGame";//"http://117.135.147.108:8091/FightGame";"http://192.168.101.109:8091/FightGame";
    Q.scale = 1;
    game.modeType = "android";
	game.platform = "91";//"9you";

    /**
     * 游戏初始化
     */
    var gameInit = function(){
        console.log("###############gameInit###############");
        fps = 15;
        var canvas = new Canvas();

        var context = new Q.CanvasContext({canvas:canvas});
        stage = new Q.Stage({width:1170, height:690, context:context, update:update});
        console.log("############# screen size = " + canvas.width + "*" + canvas.height);
        //game.scale = canvas.width / 1170;
        //console.log("game.scale="+game.scale);
        Q.scale = Math.min(canvas.width/1170,canvas.height/690);
        canvas.scale(Q.scale,Q.scale);
        //弹出层容器
        popDiv = new PopContainer();
        stage.addPop(popDiv);
        var timer = new Q.Timer(1000 / fps);
        timer.addListener(stage);
        window.timer = timer;
        timer.start();
		console.log("###############gameInit###############1");
        //进入Loading场景
        game.state = STATE.LOGO;
		console.log("###############gameInit###############2");
        fpsText = new Q.Text("",{x:stage.width -50,y:30,fontSize:15,color:"#ffffff",fontWeight:"bold",lineLength:80});
		console.log("###############gameInit###############3");
        //showFPS();
    };
    /**
     * 资源加载完成，游戏启动
     */
    game.gameStart = function () {
        console.log("#############game.gameStart##############")
        //侦听操作事件
        var em = new Q.EventManager();
        game.eventManager = em;
        var events = ["touchstart"];
        em.register(stage.context.canvas, events, function (e) {
            var ne = (e.touches && e.touches.length > 0) ? e.touches[0]:
                (e.changedTouches && e.changedTouches.length > 0) ? e.changedTouches[0] : e;
            //确保touchend事件的类型正确
            console.log("on touch======"+ne.pageX);
            //var offsetX = stage.stageX - stage.width * (Q.scale - 1);
            //var offsetY = stage.stageY - stage.height * (Q.scale - 1);

            //var x = Math.round((ne.pageX - offsetX)), y = Math.round((ne.pageY - offsetY));
            var x = Math.round(ne.pageX/Q.scale), y = Math.round(ne.pageY/Q.scale);
            console.log("on touch======x="+x);
            var obj = stage.getObjectUnderPoint(x, y);
            if (obj != null) {
                if (obj.onPress != null) {
                    obj.onPress(ne);
                    return;
                }
            }
        }, true, true);
        game.state = STATE.LOGIN;
    }


    /**
     * 游戏场景切换
     * @param timeInfo
     */
    var update = function (timeInfo) {
        frames++;
        if (game.state == currentState) {
            return;
        }
        destoryState(currentState);
        var viewClass = null;
        var bgImage = null;
        switch (game.state) {
            case STATE.LOADING:
                bgImage = new Image();
                if(game.scale == 1){
                    bgImage.src = "images/loadingN.jpg";
                }else{
                    bgImage.src = "images2/loadingN.jpg";
                }
                viewClass = BitmapLoader;
                break;
            case STATE.MAIN:
                bgImage = "main";
                viewClass = Main;
				if(game.ad == null && game.audio_switch == true){
					game.playAudio("main_bg");
				}
                break;
            case STATE.PROP:
                bgImage = "main";
                viewClass = MyProps;
                break;
            case STATE.SHOP:
                bgImage = "main";
                viewClass = Shop;
                break;
            case STATE.FIGHT:
				bgImage = "black"
                viewClass = game.fightInfo.getType() == 6 ? FightWood  :  Fight;
				if(game.audio_switch == true){
					if(game.ad.lastAudioName != "fight_bg" ){
						game.playAudio("fight_bg");
					}
				}
                break;
            case STATE.MESSAGE:
                bgImage = "main";
                viewClass = Messages;
                break;
			case STATE.MESSAGEBOARD:
                bgName = "main";
                viewClass = MessageBoard;
                break;
            case STATE.FRIEND:
                bgImage = "main";
                viewClass = Friends;
                break;
            case STATE.OPTIONS:
                bgImage = "main";
                viewClass = options;
                break;
            case STATE.INFO:
                bgImage = "main";
                viewClass = Info;
                break;
            case STATE.SKILL:
                bgImage = "main";
                viewClass = Skill;
                break;
            case STATE.WEAPON:
                bgImage = "main";
                viewClass = MyWeapon;
                break;
            case STATE.EQUIPMENT:
                bgImage = "main";
                viewClass = MyEquipment;
                break;
            case STATE.PASS:
                bgImage = "main";
                //viewClass = Pass;
                break;
            case STATE.RANDOM:
                bgImage = "main";
                viewClass = RandomFight;
                break;
            case STATE.MERGE:
                bgImage = "main";
                viewClass = Merge;
                break;
            case STATE.ARENA:
                bgImage = "main";
                viewClass = Arena;
                break;
            case STATE.SEEFRIENDINFO:
                bgImage = "main";
                break;
            // viewClass = FriendInfomation;
            case STATE.HELP:
                bgImage = "main";
                viewClass = Help;
                break;
            case STATE.EXCHANGE:
                bgImage = "main";
                viewClass = Exchange;
                break;
            case STATE.VIP:
                bgImage = "main";
                viewClass = VIP;
                break;
            case STATE.MISSION:
                bgImage = "main";
                viewClass = Mission;
                break;
            case STATE.CUPSHOP:
                bgImage = "main";
                viewClass = GoldCupShop;
                break;
            case STATE.TOPLIST:
                bgImage = "main";
                viewClass = TopList;
                break;
            case STATE.QUALIFYNEWS:
                bgImage = "main";
                viewClass = Qualifynews;
                break;
            case STATE.LOGINAWARD:
                bgImage = "main";
                viewClass = LoginAward;
                break;
            case STATE.ZDTJ:
                bgImage = "main";
                viewClass = statistics;
                break;
            case STATE.BATTLERESULT:
                bgImage = "main";
                viewClass = BattleResult;
                break;
            case STATE.EXCHANGEALERTU:
                bgImage = "main";
                viewClass = ExchangeAlertU;
                break;
            case STATE.EXCHANGEUC:
                bgImage = "main";
                viewClass = ExchangeUC;
                break;
            case STATE.RANKPREPARE:
                bgImage = "main";
                viewClass = ArenaPwsPrepare;
                break;
            case STATE.RANK:
                bgImage = "main";
                viewClass = ArenaPws;
                break;
            case STATE.START0:
                viewClass = piantou;
                break;
            case STATE.MAINLEVELUP:
                bgImage = "win";
                viewClass = mainLevelup;
                break;
            case STATE.FRIENDREQUESTNEWS:
                bgImage = "main";
                viewClass = FriendRequestNews;
                break;
			case STATE.ACTIVITY:
                bgName = "main";
                viewClass = Activity;
                break;
            case STATE.LOGIN:
                bgImage = "main";
                viewClass = Login;
                break;
            case STATE.REG:
                bgImage = "main";
                viewClass = Reg;
                break;
			case STATE.LOGO:
				bgName = "black";
				viewClass = Logo;
				break;
			case STATE.GAMESTART:
				bgName = "black";
				viewClass = GameStart;
				break;
            default:
                break;
        }
        
        //更新背景
        if(bgImage != undefined){
			if(bgName == "black"){
                stage.setBgImg(null);
            }else{
                stage.setBgImg(typeof(bgImage) == "string" ? null : bgImage);
            }
        }

		if(game.state != STATE.FIGHT && game.ad != null){
			if(game.ad.lastAudioName != "main_bg")
			{
				game.playAudio("main_bg");
			}
		}

        if (viewClass != null) {
            stage.removeAllChildren();
            viewport = new viewClass({id:"viewport", x:0, y:0, width:stage.width, height:stage.height});
            stage.addChild(viewport);
            stage.addChild(fpsText);
        }
        lastState = currentState;
        currentState = game.state;
    }

    var destoryState = function (stateName) {
        if(stateName == undefined) return;
        //UI清空
        stage.clear();
        viewport = null;
    }

    var showFPS = function () {
        setInterval(function () {
            fpsText.setText("FPS:" + frames);
            frames = 0;
        }, 1000);
    }

    /**
     * 弹出提示信息
     * @param {String} msg 提示内容
     * @param {Function} callback 回调函数，点击确认按钮后执行
     */
    game.alert = function(msg,callback,str){
        popDiv.alert(msg,callback,str);
    }
    /**
     * 显示等待动画（Ajax请求调用）
     * @param {Boolean} b 是否显示
     */
    game.showWaiting = function(b){
        if(b === true){
            popDiv.showWaiting(true);
        }else{
            popDiv.destory();
        }
    }
    /**
     * 确认窗口
     * @param {String} msg 提示内容
     * @param {Function} callback 回调函数，当选择Yes,callback参数为true,No为flase
     */
    game.confirm = function(msg,callback,stage){
        if(stage != undefined){
            popDiv.confirm(msg,callback,stage);
        }else{
            popDiv.confirm(msg,callback);
        }
    }

    game.promptCharge = function(msg,callback){
        popDiv.promptCharge(msg,callback);
    }
    game.promptExchange = function(msg,callback){
        popDiv.promptExchange(msg,callback);
    }
    game.promptBuyItem = function(msg1,msg2){
        popDiv.promptBuyItem(msg1, msg2);
    }
    /**
     * 弹出多个元件rin
     * @param {Array} children 多个显示对象集合
     * @param {String} mode 是否为模态（如果值为True，将屏蔽低层显示元件）
     */
    game.addPopUp = function(children,mode){
        popDiv.addPopUp(children,mode);
    }
    /**
     * 移除弹出内容
     */
    game.removePopUp = function(){
        popDiv.destory();
    }
    /**
     * 显示提示信息
     * @param {String} msg 提示内容
     * @param {Number} time N秒后自动移除
     */
    game.showTips = function(msg,time,size){
        popDiv.showTips(msg,time,size);
    }

    game.back = function(){
        this.state = lastState;
    }
    game.attachIME = function(callback,dft,boxRect){
        if(game.modeType == "win8"){
            //H5GameClient_showEditText(obj);
        }else if(game.modeType == "android"){
            dft = dft || "";
            console.log("attachIME default text="+dft);
            native.attachIME(function(text){
                console.log("input text="+text);
                callback(text);
            },dft);
        }
    }
    game.quit = function(){
        native.quit();
    }
    game.jumpToUrl = function(url,callback){
        if(game.modeType == "win8"){
            //H5GameClient_open(url);
        }else if(game.modeType == "android"){
            native.openBrowser(function(result){
            },game.chargeUrl);
        }

//        console.log("game.openURL ="+url);
//        callback = callback || new Function();
//        native.openBrowser(callback,url);
        //等同于window.location.href = result.feedbackUrl;
    }
    game.chooseFightBgSet = function(){
        var rd = Math.floor(Math.random()*10+1);
	
        if(rd>7){
            game.current_FightSet = FightSet_1;
        }else if(rd>5){
            game.current_FightSet = FightSet_2;
        }else if(rd > 2){
            game.current_FightSet = FightSet_3;
        }else{
            game.current_FightSet = FightSet_4;
        }
        for(var n in game.current_FightSet.source){
            game.loadArr.push(game.current_FightSet.source[n]);
        }
    }
    game.loadRes = function(loadArr,callback){
        if(loadArr.length != 0){
            var loader = new Q.ImageLoader();
            loader.addEventListener("complete", function(e){
                e.target.removeAllEventListeners();
                if(BitmapFactory.images == null){
                    BitmapFactory.images = {};
                }
                for(var key in e.images){
                    BitmapFactory.images[key] = e.images[key];
                }
                loader = null;
                callback();
            });
            loader.load(loadArr);
        }else{
            callback();
        }
    }
	game.startActivity = function(callback,str){
		native.startActivity(function(result){
			callback(result);
		},str);
	}

	game.ad = null;

	game.playAudio = function(audioName)
	{
		if(game.ad != null){
			game.ad.pause();
		}
		game.ad = null;
		game.ad = new audio;
		game.ad.lastAudioName = audioName;
		game.ad.src = "audio/"+audioName+".mp3";
		game.ad.loop = true;
		game.ad.autoPlay = true;
		game.ad.load();
		game.ad.play();
	}






    STATE =
    {
        LOADING      :0,
        MAIN         :1,
        SHOP         :2,
        PROP         :3,
        INFO         :4,
        FRIEND       :5,
        FIGHT        :6,
        MESSAGE      :7,
        OPTIONS      :8,
        WEAPON       :9,
        SKILL        :10,
        EQUIPMENT    :11,
        PASS         :12,
        RANDOM       :13,
        MATCHRESULT  :14,
        SEEFRIENDINFO:15,
        MERGE        :16,
        ARENA        :17,
        HELP         :18,
        EXCHANGE     :19,
        VIP          :20,
        MISSION      :21,
        CUPSHOP      :22,
        TOPLIST      :23,
        QUALIFYNEWS  :24,
        LOGINAWARD   :25,
        ZDTJ         :26,
        BATTLERESULT : 27,
        EXCHANGEALERTU:28,
        EXCHANGEUC:29,
        RANKPREPARE:30,
        RANK:31,
        START0:32,
        MAINLEVELUP:33,
        FRIENDREQUESTNEWS:34,
        LOGIN:35,
        REG:36,
        MESSAGEBOARD:37,
        LOGO:38,
        ACTIVITY:39,
		GAMESTART:40
    };
    newbie_State =
    {
        Loading      :0,
        FirstBattle         :1,
        CheckMsg         :4,
        Lvl2         :5,
        UseProp         :6,
        Lvl3       :11,
        Upgrade        :14,
        Lvl5      :17,
        Lvl10       :18
    };
    window.game = game;
})();