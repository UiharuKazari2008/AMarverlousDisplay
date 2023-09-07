const config = require('./config.json');
const { SerialPort } = require('serialport');
const moment = require('moment');
const express = require('express');
const app = express();
const apiPort = config.apiPort || 7878;
const staticCommands = {
    reset: new Uint8Array(Buffer.from(['0x1B','0x0B'])),
    power_on: new Uint8Array(Buffer.from(['0x1B','0x21','0x01'])),
    power_off: new Uint8Array(Buffer.from(['0x1B','0x21','0x00'])),
    brightness: [
        new Uint8Array(Buffer.from(['0x1B','0x20','0x01'])),
        new Uint8Array(Buffer.from(['0x1B','0x20','0x02'])),
        new Uint8Array(Buffer.from(['0x1B','0x20','0x03'])),
        new Uint8Array(Buffer.from(['0x1B','0x20','0x04'])),
    ],
    cursor: new Uint8Array(Buffer.from(['0x1B','0x30'])),
    charset: new Uint8Array(Buffer.from(['0x1B','0x32'])),
    scroll_set: new Uint8Array(Buffer.from(['0x1B','0x50'])),
    scroll_cursor: new Uint8Array(Buffer.from(['0x1B','0x40'])),
    scroll_speed: new Uint8Array(Buffer.from(['0x1B','0x41'])),
    scroll_start: new Uint8Array(Buffer.from(['0x1B','0x51']))
}
let clockTimer = null;
let lastLine1 = ''
let lastLine2 = ''
let lastMsg1 = ''
let lastMsg2 = ''
let lastBrightness = 1;
let scrollEnabled = false;
let clockEnabled = false;
let simpleMode = false;
let autoHideTimer = null;
let autoPowerOffTimer = null;
let resetTimer = null;
let powerState = false;
let messages = [];
let activeMessages = false;

// Display Must to powered on after a reset command
// 20 columns
// 2 Lines and 1 Center Line

// Open COM port
const port = new SerialPort({path: config.serialPort || "COM50", baudRate: 115200 });

// General Placeholder to verify access
app.use(function(req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "X-Requested-With");
    next();
});
app.get('/', (req, res) => { res.send('Display Driver API!'); });
app.get('/ports', async (req, res) => { res.json(await SerialPort.list()); });

// Set VFD Power Supply state and Brightness
function setPower(power, brightness) {
    powerState = power;
    port.write(staticCommands.reset, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    port.write((power) ? staticCommands.power_on : staticCommands.power_off, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    if (power)
        port.write(staticCommands.brightness[brightness], (err) => { if (err) { console.error('Error on write: ', err.message) } });
    if (!power) {
        messages = [];
        activeMessages = false;
    }
}
// Set VFD Brightness (1-3, Low to Max)
// Very slight changes but could help with longesvity
function setBrightness(brightness) {
    port.write(staticCommands.brightness[brightness], (err) => { if (err) { console.error('Error on write: ', err.message) } });
}
// Write a line to the display and options
// .clear : Clear Line on display before writing (When writing it will overlap last line)
// .x, y : Cursor position on display
// .charset : Character Set to use (See Manual for details)
function writeLine(text, opts) {
    if (opts.clear) {
        port.write(staticCommands.cursor, (err) => { if (err) { console.error('Error on write: ', err.message) } });
        if (opts && (opts.x !== undefined && opts.y !== undefined)) {
            const byteArrayX = new Uint8Array(2);
            const byteArrayY = new Uint8Array(1);
            byteArrayX[0] = opts.x >> 8;
            byteArrayX[1] = opts.x & 0xff;
            byteArrayY[0] = opts.y;
            port.write(byteArrayX, (err) => { if (err) { console.error('Error on write: ', err.message) } });
            port.write(byteArrayY, (err) => { if (err) { console.error('Error on write: ', err.message) } });
        } else {
            port.write(new Uint8Array(Buffer.from(['0x00','0x00','0x00'])), (err) => { if (err) { console.error('Error on write: ', err.message) } });
        }
        port.write(new Uint8Array(Buffer.from([
            '0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40',
            '0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40'
        ])), (err) => { if (err) { console.error('Error on write: ', err.message) } });
    }
    if (opts && (opts.x !== undefined && opts.y !== undefined)) {
        const byteArrayX = new Uint8Array(2);
        const byteArrayY = new Uint8Array(1);
        byteArrayX[0] = opts.x >> 8;
        byteArrayX[1] = opts.x & 0xff;
        byteArrayY[0] = opts.y;
        port.write(staticCommands.cursor, (err) => { if (err) { console.error('Error on write: ', err.message) } });
        port.write(byteArrayX, (err) => { if (err) { console.error('Error on write: ', err.message) } });
        port.write(byteArrayY, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    }
    port.write(staticCommands.charset, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    if (opts && opts.charset !== undefined) {
        const byteArrayC = new Uint8Array(1);
        byteArrayC[0] = opts.charset;
        port.write(byteArrayC, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    } else {
        port.write(new Uint8Array(Buffer.from(['0x02'])), (err) => { if (err) { console.error('Error on write: ', err.message) } });
    }
    console.log(text)
    if (opts.raw) {
        port.write(line, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    } else {
        text.split('$#').map(line => {
            if (line.endsWith("#$")) {
                port.write(new Uint8Array(Buffer.from([...line.substring(0, line.length - 2).split(/(..)/g).filter(s => s).map(s => "0x" + s)])), (err) => { if (err) { console.error('Error on write: ', err.message) } });
            } else {
                port.write(line, (err) => { if (err) { console.error('Error on write: ', err.message) } });
            }
        })
    }
}
// Write a line to the display and options
// If line is to long then it will auto scroll
// Mainly used when the clock is on the display
// See options for Scroll
function writeLineAuto(text, opts) {
    if ((text.length > 13 && !(opts && opts.y === 0)) || (text.length > 20 && !(opts && opts.y === 2))) {
        scrollLine(text, {
            x: 0,
            y: 2,
            speed: 15,
            padding: 10,
            width: (!(opts && opts.y === 2)) ? 200 : 105,
            ...opts,
        })
    } else {
        if (scrollEnabled) {
            scrollEnabled = false;
            resetDisplay(true);
        }
        writeLine(text, {
            x: 0,
            y: 2,
            clear: true,
            ...opts,
        });
        if (config.clock)
            writeClock();
    }
}
// Reset the display and restore previous liness
// If noLine2 is set then it will no write the status line
function resetDisplay(noline2) {
    const brightness = lastBrightness || config.initBrightness || 1;
    setPower(true, brightness);
    if (!simpleMode) {
        writeLine((activeMessages) ? `[!${(messages.length > 0) ? messages.length : ''}] ${lastMsg1}` : lastLine1, {x: 0, y: 0});
        if (!noline2)
            writeLineAuto((activeMessages) ? lastMsg2 : lastLine2, {x: 0, y: 2});
    }
    writeClock();
}
// Create a scroll box to display a line of scrolling text
// No need to clear the line as the scrollbox will overwrite that area
// .x, y : Cursor position on display
// .charset : Character Set to use (See Manual for details)
// .width : Width of scroll box
// .speed : Speed of scrolling text (1-15, I don't fully understand the equation but i know the values)
function scrollLine(text, opts) {
    scrollEnabled = true;
    port.write(staticCommands.scroll_cursor, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    if (opts && (opts.x !== undefined && opts.y !== undefined)) {
        const byteArrayX = new Uint8Array(2);
        const byteArrayY = new Uint8Array(1);
        byteArrayX[0] = opts.x >> 8;
        byteArrayX[1] = opts.x & 0xff;
        byteArrayY[0] = opts.y;
        port.write(byteArrayX, (err) => { if (err) { console.error('Error on write: ', err.message) } });
        port.write(byteArrayY, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    } else {
        port.write(new Uint8Array(Buffer.from(['0x00', '0x00', '0x00'])), (err) => { if (err) { console.error('Error on write: ', err.message) } });
    }
    if (opts && opts.width !== undefined) {
        const byteArrayW = new Uint8Array(2);
        byteArrayW[0] = opts.width >> 8;
        byteArrayW[1] = opts.width & 0xff;
        port.write(byteArrayW, (err) => { if (err) { console.error('Error on write: ', err.message) } });
        port.write(new Uint8Array(Buffer.from(['0x00'])), (err) => { if (err) { console.error('Error on write: ', err.message) } });
    } else {
        port.write(new Uint8Array(Buffer.from(['0x00', '0xA0', '0x00'])), (err) => { if (err) { console.error('Error on write: ', err.message) } });
    }
    if (opts && opts.speed !== undefined && opts.speed <= 15) {
        const byteArrayS = new Uint8Array(1);
        byteArrayS[0] = opts.speed;
        port.write(staticCommands.scroll_speed, (err) => { if (err) { console.error('Error on write: ', err.message) } });
        port.write(byteArrayS, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    }
    port.write(staticCommands.charset, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    if (opts && opts.charset !== undefined) {
        const byteArrayC = new Uint8Array(1);
        byteArrayC[0] = opts.charset;
        port.write(byteArrayC, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    } else {
        port.write(new Uint8Array(Buffer.from(['0x02'])), (err) => { if (err) { console.error('Error on write: ', err.message) } });
    }
    port.write(staticCommands.scroll_set, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    const bufferText = new Uint8Array(Buffer.from(text.padEnd(text.length + (opts.padding || 0))));
    const byteArrayL = new Uint8Array(1);
    byteArrayL[0] = bufferText.length;
    port.write(byteArrayL, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    port.write(bufferText, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    port.write(staticCommands.scroll_start, (err) => { if (err) { console.error('Error on write: ', err.message) } });
}
// Create a scroll box to display a line of scrolling raw text bytes
// No need to clear the line as the scrollbox will overwrite that area
// .x, y : Cursor position on display
// .charset : Character Set to use (See Manual for details)
// .width : Width of scroll box
// .speed : Speed of scrolling text (1-15, I don't fully understand the equation but i know the values)
function scrollRaw(text, opts) {
    scrollEnabled = true;
    port.write(staticCommands.scroll_cursor, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    if (opts && (opts.x !== undefined && opts.y !== undefined)) {
        const byteArrayX = new Uint8Array(2);
        const byteArrayY = new Uint8Array(1);
        byteArrayX[0] = opts.x >> 8;
        byteArrayX[1] = opts.x & 0xff;
        byteArrayY[0] = opts.y;
        port.write(byteArrayX, (err) => { if (err) { console.error('Error on write: ', err.message) } });
        port.write(byteArrayY, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    } else {
        port.write(new Uint8Array(Buffer.from(['0x00', '0x00', '0x00'])), (err) => { if (err) { console.error('Error on write: ', err.message) } });
    }
    if (opts && opts.width !== undefined) {
        const byteArrayW = new Uint8Array(2);
        byteArrayW[0] = opts.width >> 8;
        byteArrayW[1] = opts.width & 0xff;
        port.write(byteArrayW, (err) => { if (err) { console.error('Error on write: ', err.message) } });
        port.write(new Uint8Array(Buffer.from(['0x00'])), (err) => { if (err) { console.error('Error on write: ', err.message) } });
    } else {
        port.write(new Uint8Array(Buffer.from(['0x00', '0xA0', '0x00'])), (err) => { if (err) { console.error('Error on write: ', err.message) } });
    }
    if (opts && opts.speed !== undefined && opts.speed <= 15) {
        const byteArrayS = new Uint8Array(1);
        byteArrayS[0] = opts.speed;
        port.write(staticCommands.scroll_speed, (err) => { if (err) { console.error('Error on write: ', err.message) } });
        port.write(byteArrayS, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    }
    port.write(staticCommands.charset, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    if (opts && opts.charset !== undefined) {
        const byteArrayC = new Uint8Array(1);
        byteArrayC[0] = opts.charset;
        port.write(byteArrayC, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    } else {
        port.write(new Uint8Array(Buffer.from(['0x02'])), (err) => { if (err) { console.error('Error on write: ', err.message) } });
    }
    port.write(staticCommands.scroll_set, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    const byteArrayL = new Uint8Array(1);
    byteArrayL[0] = text.length;
    port.write(byteArrayL, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    port.write(text, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    port.write(staticCommands.scroll_start, (err) => { if (err) { console.error('Error on write: ', err.message) } });
}

// Write the formatted Clock in the designated area
// Location is determined if its in hidden mode or not
function writeClock() {
    let time = moment().format(config.clock.format || "HH:mm")
    if (simpleMode) {
        writeLine(new Uint8Array(Buffer.from(time)), {x: 60, y: 1, raw: true})
    } else {
        time = time.padStart(time.length + 1)
        writeLine(new Uint8Array(Buffer.from(time)), {x: config.clock.x || 0, y: config.clock.y || 0, raw: true})
    }
}
// Start the clock refresh timer
function startClock() {
    if (config.clock) {
        writeClock();
        clockEnabled = true;
        clearInterval(clockTimer);
        clockTimer = setInterval(writeClock, 5000)
    }
}
// Stop the clock refresh timer
function stopClock() {
    clockEnabled = false;
    clearInterval(clockTimer)
    clockTimer = null;
}
// Start the auto hide clock display
function autoHide() {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
    simpleMode = true;
    lastBrightness = 1;
    resetDisplay();
    startClock();
}

console.log('Marvelous Display Driver v1 by Yukimi Kazari');

if (config.autoStart) {
    setPower(true, config.initBrightness || 1);
    lastBrightness = config.initBrightness || 1;
    if (!simpleMode) {
        if (config.initLine1) {
            writeLine(config.initLine1, {x: 0, y: 0})
            lastLine1 = config.initLine1
        }
        if (config.initLine2) {
            writeLineAuto(config.initLine2, {x: 0, y: 2})
            lastLine2 = config.initLine2
        }
    }
    if (config.clock)
        startClock();
    if (config.autoHideSec) {
        autoHideTimer = setTimeout(autoHide, config.autoHideSec * 1000);
    }
} else {
    console.log('Auto Start is disabled, You must call powerOn to start display!')
}

app.get('/powerOn', (req, res) => {
    simpleMode = false;
    let brightness = config.initBrightness || 1;
    if (req.query.brightness)
        brightness = parseInt(req.query.brightness);
    if (brightness > 3)
        brightness = 3;
    lastBrightness = brightness;
    setPower(true, brightness);
    writeLine((activeMessages) ? `[!${(messages.length > 0) ? messages.length : ''}] ${lastMsg1}` : lastLine1, {x: 0, y: 0});
    writeLineAuto((activeMessages) ? lastMsg2 : lastLine2, {x: 0, y: 2});
    startClock();
    if (config.autoHideSec) {
        autoHideTimer = setTimeout(autoHide, config.autoHideSec * 1000);
    }
    console.log("Display Power Supply On");
    res.send('OK');
});
app.get('/powerOff', (req, res) => {
    if (autoHideTimer) {
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
    }
    setPower(false)
    console.log("Display Power Supply Off");
    res.send('OK');
});
app.get('/powerState', (req, res) => {
    res.send(powerState);
});
app.get('/reset', (req, res) => {
    let brightness = config.initBrightness || 1;
    if (req.query.brightness)
        brightness = parseInt(req.query.brightness);
    if (brightness > 3)
        brightness = 3;
    lastBrightness = brightness;
    setPower(true, brightness);
    console.log("Display Reset");
    res.send('OK');
});
app.get('/enableClock', (req, res) => {
    startClock()
    console.log("Clock Enabled");
    res.send('OK');
});
app.get('/disableClock', (req, res) => {
    stopClock()
    console.log("Clock Disabled");
    res.send('OK');
});

app.get('/standby', (req, res) => {
    simpleMode = true;
    lastBrightness = 1;
    resetDisplay();
    startClock();
    console.log("Simple Clock Enabled");
    res.send('OK');
});
app.get('/wakeUp', (req, res) => {
    simpleMode = false;
    lastBrightness = config.initBrightness || 3;
    resetDisplay();
    if (config.wakeUpBrightness)
        setBrightness(config.wakeUpBrightness);
    console.log("Poke Display");
    res.send('OK');
    if (config.autoHideSec || req.query.timeout) {
        autoHideTimer = setTimeout(autoHide, ((req.query.timeout) ? parseInt(req.query.timeout.toString()) : config.autoHideSec) * 1000);
    }
});
app.get('/reload', (req, res) => {
    simpleMode = false;
    lastBrightness = config.initBrightness || 3;
    resetDisplay();
    console.log("Reloaded Display");
    res.send('OK');
});

app.get('/getHeader', (req, res) => {
    res.send((activeMessages) ? `[!${(messages.length > 0) ? messages.length : ''}] ${lastMsg1}` : lastLine1);
});
app.get('/setHeader', (req, res) => {
    if (req.query.text && (powerState || (!powerState && config.powerOnWithText))) {
        const textValue = req.query.text;
        lastLine1 = textValue;
        if (!activeMessages) {
            if (autoHideTimer) {
                clearTimeout(autoHideTimer);
                autoHideTimer = null;
            }

            if (simpleMode || !powerState) {
                simpleMode = false;
                lastBrightness = config.initBrightness || 3;
                resetDisplay();
                if (config.wakeUpBrightness)
                    setBrightness(config.wakeUpBrightness);
            } else {
                writeLine(textValue, {x: 0, y: 0, clear: true});
            }
            console.log("Write Header: " + textValue);
            if (req.query.brightness)
                setBrightness(parseInt(req.query.brightness.toString()));
            res.status(200).send(textValue);
            if ((config.autoHideSec || req.query.timeout) && !req.query.keepAwake) {
                autoHideTimer = setTimeout(autoHide, ((req.query.timeout) ? parseInt(req.query.timeout.toString()) : config.autoHideSec) * 1000);
            }
        } else {
            console.log("Write Header: " + textValue);
            res.status(200).send(textValue);
        }
    } else {
        res.status(400).send('The query "text" is required!');
    }
})
app.get('/getStatus', (req, res) => {
    res.send(lastLine2);
});
app.get('/setStatus', (req, res) => {
    if (req.query.text && (powerState || (!powerState && config.powerOnWithText))) {
        const textValue = req.query.text;
        lastLine2 = textValue;
        if (!activeMessages) {
            if (autoHideTimer) {
                clearTimeout(autoHideTimer);
                autoHideTimer = null;
            }
            if (simpleMode || !powerState) {
                simpleMode = false;
                lastBrightness = config.initBrightness || 3;
                resetDisplay();
                if (config.wakeUpBrightness)
                    setBrightness(config.wakeUpBrightness);
            } else {
                writeLineAuto(textValue, {x: 0, y: 2, clear: true});
            }
            console.log("Write Status: " + textValue);
            if (req.query.brightness)
                setBrightness(parseInt(req.query.brightness.toString()));
            res.status(200).send(textValue);
            if ((config.autoHideSec || req.query.timeout) && !req.query.keepAwake) {
                autoHideTimer = setTimeout(autoHide, ((req.query.timeout) ? parseInt(req.query.timeout.toString()) : config.autoHideSec) * 1000);
            }
        } else {
            console.log("Write Status: " + textValue);
            res.status(200).send(textValue);
        }
    } else {
        res.status(400).send('The query "text" is required!');
    }
})
app.get('/setBoth', (req, res) => {
    if (req.query.header && req.query.status && (powerState || (!powerState && config.powerOnWithText))) {
        const header = req.query.header;
        const status = req.query.status;
        lastLine1 = header;
        lastLine2 = status;
        if (!activeMessages) {
            if (autoHideTimer) {
                clearTimeout(autoHideTimer);
                autoHideTimer = null;
            }
            if (simpleMode || !powerState) {
                simpleMode = false;
                lastBrightness = config.initBrightness || 3;
                resetDisplay();
                if (config.wakeUpBrightness)
                    setBrightness(config.wakeUpBrightness);
            } else {
                writeLine(header, {x: 0, y: 0, clear: true});
                writeLineAuto(status, {x: 0, y: 2, clear: true});
            }
            console.log("Write Header: " + header);
            console.log("Write Status: " + status);
            if (req.query.brightness)
                setBrightness(parseInt(req.query.brightness.toString()));
            res.status(200).send(header + '\n' + status);
            if ((config.autoHideSec || req.query.timeout) && !req.query.keepAwake) {
                autoHideTimer = setTimeout(autoHide, ((req.query.timeout) ? parseInt(req.query.timeout.toString()) : config.autoHideSec) * 1000);
            }
        } else {
            console.log("Write Header: " + header);
            console.log("Write Status: " + status);
            res.status(200).send(header + '\n' + status);
        }
    } else {
        res.status(400).send('The query "text" is required!');
    }
})
app.get('/setText', (req, res) => {
    if (req.query.text && powerState) {
        const textValue = req.query.text;
        console.log("Write Text: " + textValue);
        writeLine(textValue, {x: 0, y: 0, ...req.query, text: undefined});
        res.status(200).send(textValue);
    } else {
        res.status(400).send('The query "text" is required!');
    }
})
app.get('/alertBoth', (req, res) => {
    if (req.query.header && req.query.status && (powerState || (!powerState && config.powerOnWithText))) {
        const header = req.query.header;
        const status = req.query.status;

        simpleMode = false;
        if (!powerState) {
            setPower(true, 3);
        }
        writeLineAuto(header, {x: 0, y: 0, clear: true});
        writeLine(status, {x: 0, y: 2, clear: true});
        if (config.clock) {
            let time = moment().format(config.clock.format || "HH:mm")
            time = time.padStart(time.length + 1)
            writeLine(new Uint8Array(Buffer.from(time)), {x: 110, y: 2, raw: true})
        }
        clearTimeout(autoHideTimer);
        autoHideTimer = null;
        clearTimeout(resetTimer);
        resetTimer = null;
        if (config.autoHideSec) {
            autoHideTimer = setTimeout(autoHide, config.autoHideSec * 1000);
        } else {
            resetTimer = setTimeout(resetDisplay, 5000);
        }
        res.status(200).send('Displayed');
    } else {
        res.status(400).send('The query "text" is required!');
    }
})

app.get('/addMessage', (req, res) => {
    const header = req.query.header;
    const status = req.query.status;
    lastMsg1 = header;
    lastMsg2 = status;
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
    if (!activeMessages && messages.length === 0) {
        activeMessages = true;
        if (simpleMode || !powerState) {
            simpleMode = false;
            resetDisplay();
        } else {
            writeLine('[!] ' + header, {x: 0, y: 0, clear: true});
            writeLineAuto(status, {x: 0, y: 2, clear: true});
        }
        console.log("Write Header: " + header);
        console.log("Write Status: " + status);
        setBrightness(3);
        res.status(200).send('Displayed');
    } else {
        messages.push([header, status])
        resetDisplay();
        res.status(200).send('Qed')
    }
})
app.get('/nextMessage', (req, res) => {
    clearTimeout(autoHideTimer);
    autoHideTimer = null;
    if (messages.length === 0) {
        activeMessages = false;
        resetDisplay();
        if (config.autoHideSec) {
            autoHideTimer = setTimeout(autoHide, config.autoHideSec * 1000);
        }
        res.status(200).send('Empty')
    } else {
        const nextMsg = messages.pop()
        lastMsg1 = nextMsg[0];
        lastMsg2 = nextMsg[1];
        if (simpleMode || !powerState) {
            simpleMode = false;
            resetDisplay();
        } else {
            writeLine(`[!${(messages.length > 0) ? messages.length : ''}] ${lastMsg1}`, {x: 0, y: 0, clear: true});
            writeLineAuto(lastMsg2, {x: 0, y: 2, clear: true});
        }
        res.status(200).send('Next')
    }
})

if (config.enableAPI) {
    app.listen(apiPort, () => {
        console.log(`Listening at http://0.0.0.0:${apiPort}`);
    });
}
