const electron = require('electron');
const path = require('path');
const url = require('url');
const request = require('request');
const electronLocalshortcut = require('electron-localshortcut');
const storage = require('electron-json-storage');
const randomstring = require('randomstring');
const dotenv = require('dotenv');
const AutoLaunch = require('auto-launch');

const { app, BrowserWindow, Menu, ipcMain, dialog } = electron;

let mainWindow;
let mainMenuTemplate = []; 

const envPath = path.join( ( __dirname ).substring( 0, ( __dirname.length - 4 ) ), '/.env' );
dotenv.config( { path: envPath } );

const autolauncher = new AutoLaunch({
    name: 'Whispers, by 100 Million Books'
});


/*****************
crucial app-wide settings
*****************/

if( process.platform === 'linux' ) {
    app.commandLine.appendSwitch('enable-transparent-visuals');
    app.commandLine.appendSwitch('disable-gpu');
}


/*****************
app-wide listeners
*****************/

process.on( 'uncaughtException', function( e ) {  
    console.log( e );
    dialog.showErrorBox( "Error", "Unknown error. If this keeps happening, tell the developer.");
});


/*****************
interwindow communication
*****************/

//listen for request for new book
ipcMain.on( 'get-next-book', ( event, arg ) => {  
	
	//check books
	storage.get( 'current_book', function( error, cb ) {
		if( ( Object.keys( cb ) ).length ) {
			if( cb.timestamp > ( new Date().getTime() ) ) {		//10 seconds
				launch_whisper( cb );
				event.sender.send( 'get-book-response', { error: false, data: cb } );
			} else {
				pop_new_book( event );
			}
			
		} else {
			pop_new_book( event );
		}
	});
	
	return;
});

ipcMain.on( 'toggle-autostart', ( event, arg ) => {  
	
    if( arg ) {
        autolauncher.enable();
    } else {
        autolauncher.disable();
    }
    
	return;
});


/*****************
app startup stuff
*****************/

//listen for app to be ready
app.on( 'ready', function() { 

	launch_main_window();
   
	return;
    
});

/*****************
functions
*****************/

function pop_new_book( event ) {
	
	storage.getMany( [ 'books', 'app_defaults' ], function( error, data ) {
		
		if( data.books.length ) {
			let cb = {};
			cb.book = data.books.shift();
			cb.timestamp = ( new Date().getTime() + data.app_defaults.whisper_interval );
			
			launch_whisper( cb );
			event.sender.send( 'get-book-response', { error: false, data: cb } );
			
			//set current book
			storage.set( 'current_book', cb );
			
			//set book array; load more if necesssary
			storage.set( 'books', data.books, function() {
				if( data.books.length < 5 ) {
					prepare_load_books( false, event );
				}
			});
			
		} else {
			prepare_load_books( true, event );
		}
    });
    
    //check for software updates
    /* request( "https://api.github.com/repos/bisq-network/bisq-desktop/releases/latest", { json: true, headers: { 'User-Agent': '100 Million Books for Desktop' } }, ( err, res, body ) => {
        if( err ) { 
            console.log( "Error in checking for updates." );
            
            return;
        } else {
            //body = body.replace(/'/g, '"');
            //console.log( body );
            if( ( typeof body === 'object' ) && body.hasOwnProperty( 'tag_name' ) ) {
                console.log( body['tag_name'] );
            } else {
                //error...can't do update
            }
        }
    }); */
	
	return;
}

function set_defaults() {
    
    storage.set( 'app_defaults', {
        whisper_interval: 20000,    //1200000
        whisper_duration: 1200,
        autostart: true
    });
    
    autolauncher.enable();
    
    return;
}

function prepare_load_books( send_back, event ) {
	
	storage.get( 'first_run', function( error, fr ) {
		
		let first_run = false;
		if( fr ) {	//{}, the default when it's unset (e.g., first run)
			first_run = true;
            set_defaults();
			storage.set( 'first_run', false );
		}
		
        storage.get( 'client_id', function( error, cid ) {
            
            if( typeof cid === 'object' ) { //will be string if already set
                let new_client_id = process.platform + randomstring.generate(54);
                storage.set( 'client_id', new_client_id, function() {
                    load_books( send_back, event, first_run, new_client_id );
                });
            } else {
                load_books( send_back, event, first_run, cid );
            }
            
        });
	});
	
}

function load_books( send_back, event, first_run, cid ) {
    
    request( process.env.DA_HOST + '?uid=' + cid + '&callback=?', { json: true }, ( err, res, body ) => {
        if( err ) { 
            storage.get( 'books', function( error, all_books ) {
                
                if( Array.isArray( all_books ) ) {
                    if( all_books.length === 0 ) {
                        event.sender.send( 'get-book-response', { error: true, data: { first_run: first_run } } );
                    }
                } else if( ( Object.keys( all_books ) ).length === 0 ) {
                    event.sender.send( 'get-book-response', { error: true, data: { first_run: first_run } } );
                }
            })
            
            return;
        } else {
            
            try {
                let ready_to_display = transform_data( JSON.parse( body.slice( 2, -1 ) ) );
                
                storage.getMany( [ 'books', 'app_defaults' ], function( error, data ) {
                    if( Array.isArray( data.books ) ) {
                        data.books = (data.books).concat( ready_to_display );
                    } else {
                        data.books = ready_to_display;
                    }
                    
                    if( send_back ) {
                        let cb = {};
                        cb.book = (data.books).shift();
                        cb.timestamp = ( new Date().getTime() + data.app_defaults.whisper_interval  );
                        
                        storage.set( 'books', data.books );
                        storage.set( 'current_book', cb, function() {
                        
                            cb.first_run = first_run;
                        
                            launch_whisper( cb );
                            event.sender.send( 'get-book-response', { error: false, data: cb } );
                        });
                    } else {
                        storage.set( 'books', data.books );
                    }
                });
            } catch(e) {
                //don't do anything
                console.log( "FAILED. COME AT ME BRO." );
            }
        }
    });

    
}

function transform_data( json ) {
        
	for( let o in json ) {
					
		if( json[o]['supersnip_text'] ) {
			json[o]['supersnip_text'] = ( json[o]['supersnip_text'] ).substring( 1, ( json[o]['supersnip_text'].length - 1 ) );
			
			if( json[o]['supersnip_text'] ===  "<p class='visual-quote'>If you're seeing this message, you're running an old version of the Chrome extension.<br><br>Please update!</p>" ) {
				json[o]['supersnip_text'] = null;
			}
		}
		
		let year = json[o]['year'];
		
		if( year < 1500 ) {
			if( year < 0 ) {
				year = Math.abs(year) + " BC";
			} else {
				year = Math.abs(year) + " AD";
			}
		}
		
		json[o]['year'] = year;
	}
	
	return json;
}

function launch_whisper( cb ) {
	
    let {width, height} = electron.screen.getPrimaryDisplay().size;
	
	let icon_pic = "";
	if( (process.platform == 'darwin') ) {
		icon_pic: path.join( __dirname, '../img/whisper_icon.ico' )
	} else {
		icon_pic = path.join( __dirname, '../img/whisper_icon.png' );
	}
    
    let whisper = new BrowserWindow({
        width: 325, 
        height: 67, 
        x: parseInt(width - 375, 10),
        y: parseInt(height - 157, 10),
        show: false,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        resizable: false,
        movable: false,
        title: "Whisper",
        icon: icon_pic,
        backgroundColor: '#444',
        opacity: 0.8,
		fullscreenable: false,
		focusable: false,
        //darkTheme: true,    //
        thickFrame: false,  //only for windows
        //type: 'notification'    //only valid for linux
    });
    
    whisper.loadURL(url.format({
        pathname: path.join( __dirname, '/whisper.html' ),
        protocol: 'file:',
        slashes: true
    }));
	
	let author_and_title = cb.book.author.split( "," )[0] + ": " + cb.book.title;	//only show first author's name
	
	let supersnip_stripped = ( cb.book.supersnip_text ).replace( /<[^>]+>/g, '' );	//strip html
    supersnip_stripped = supersnip_stripped.replace( /\n|\r/g, ' ');	//strip line breaks

    whisper.on( 'ready-to-show', function( w ) {
        whisper.showInactive();
		whisper.webContents.send( "change-whisper-text", { title: author_and_title, message: supersnip_stripped.substr( 0, 150 ) } );
    });

    whisper.on( 'show', function( w ) {
        
        storage.get( 'app_defaults', function( error, ad ) {
            
            setTimeout( function() {
                try {
                    whisper.close();
                } catch(e) {
                    //don't do anything...random and unnecessary
                }
            }, ad.whisper_duration );
        });
        
        return;
    });
    
    whisper.on( 'close', function( w ) {
		whisper = null;
        return;
    });
    
    return;
}

function launch_main_window() {
	
	let icon_pic = "";
	if( (process.platform == 'darwin') ) {
		icon_pic: path.join( __dirname, '../img/icon.ico' )
	} else {
		icon_pic = path.join( __dirname, '../img/icon.png' );
	}
    
    //create new window
    let {width, height} = electron.screen.getPrimaryDisplay().size;
    height = parseInt(height * 0.75, 10);
    width = parseInt(width * 0.75, 10);
    mainWindow = new BrowserWindow({
        height: ( ( height > 900 ) ? 900 : height ),
        width: ( ( width > 1600 ) ? 1600 : width ),
        backgroundThrottling: false,
        icon: icon_pic,
		show: false
    });
    
    //load html in window
    mainWindow.loadURL(url.format({
        pathname: path.join( __dirname, '/main.html' ),
        protocol: 'file:',
        slashes: true
    }));
	
	mainWindow.on( 'ready-to-show', function( w ) {
		mainWindow.maximize();
        mainWindow.show();
	});
    
    //quit app when closed listener
    mainWindow.on('closed', function(){
        app.quit();
        mainWindow = null;
    });
    

    //build menu from template
    const mainMenu = Menu.buildFromTemplate(mainMenuTemplate);
    
    //insert menu
    Menu.setApplicationMenu(mainMenu);
    
    return;
}

//add developer tools option if in dev
if( process.env.NODE_ENV === 'development' ) {
    electronLocalshortcut.register( 'CommandOrControl+I', () => {
        mainWindow.toggleDevTools();
        //return;
    });
    electronLocalshortcut.register( 'CommandOrControl+R', () => {
        mainWindow.reload();
        //return;
    });
}

//if OSX, add empty object to menu
if( process.platform == 'darwin' ) {
    mainMenuTemplate.unshift(
        {
            label: app.getName(),
            submenu: [
                {
                    label: 'Preferences',
                    click() { mainWindow.webContents.send( 'open-dialog', 'settings' ); }
                },
                { type: 'separator' },
                { role: 'quit' }
            ]
        }
    );
} else {
    mainMenuTemplate.push(
        {
            label: 'File',
            submenu: [
                {
                    label: 'Settings',
                    click() { mainWindow.webContents.send( 'open-dialog', 'settings' ); }
                },
                { type: 'separator' },
                {
                    role: 'quit'
                }
            ]
        }
	)
};
	
mainMenuTemplate.push(
	{
		label: 'View',
		submenu: [
			{ role: 'zoomin' },
			{ role: 'zoomout' },
			{ type: 'separator' },
			{ role: 'resetzoom' }
		]
	},
	{
		label: 'Help',
		submenu: [
			{
				label: 'About',
				click() { mainWindow.webContents.send( 'open-dialog', 'about' ); }
			},
			{
				label: 'Privacy Policy',
				click() { mainWindow.webContents.send( 'open-dialog', 'privacy' ); }
			},
			{ type: 'separator' },
			{
				label: 'The Occasional Curiosity',
				click() { mainWindow.webContents.send( 'open-dialog', 'oc' ); }
			},
			{
				label: 'The Rediscovery Series',
				click() { mainWindow.webContents.send( 'open-dialog', 'rediscovery' ); }
			},
			{
				label: 'Twitter',
				click() { mainWindow.webContents.send( 'open-dialog', 'twitter' ); }
			},
			{
				label: 'Facebook',
				click() { mainWindow.webContents.send( 'open-dialog', 'facebook' ); }
			}
		]
	}
);