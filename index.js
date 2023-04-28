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
let lastBrightness = 1;
let scrollEnabled = false;
let clockEnabled = false;
let simpleMode = false;
let autoHideTimer = null;
let autoPowerOffTimer = null;
let powerState = false;

const port = new SerialPort({path: config.serialPort || "COM50", baudRate: 115200 });

app.get('/', (req, res) => { res.send('Display Driver API!'); });
app.get('/ports', async (req, res) => { res.json(await SerialPort.list()); });
// 20 columns
function setPower(power, brightness) {
    powerState = power;
    port.write(staticCommands.reset, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    port.write((power) ? staticCommands.power_on : staticCommands.power_off, (err) => { if (err) { console.error('Error on write: ', err.message) } });
    if (power)
        port.write(staticCommands.brightness[brightness], (err) => { if (err) { console.error('Error on write: ', err.message) } });
}
function setBrightness(brightness) {
    port.write(staticCommands.brightness[brightness], (err) => { if (err) { console.error('Error on write: ', err.message) } });
}
function writeLine(text, opts) {
    // x, y, charset
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
        port.write(new Uint8Array(Buffer.from(['0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40','0x81', '0x40',
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
    port.write(text, (err) => { if (err) { console.error('Error on write: ', err.message) } });
}
function writeLineAuto(text, opts) {
    if (text.length > 13) {
        scrollLine(text, {
            x: 0,
            y: 2,
            speed: 15,
            width: 105,
            padding: 10,
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
function resetDisplay(noline2) {
    const brightness = lastBrightness || config.initBrightness || 1;
    setPower(true, brightness);
    if (!simpleMode) {
        writeLine(lastLine1, {x: 0, y: 0});
        if (!noline2)
            writeLineAuto(lastLine2, {x: 0, y: 2});
    }
    writeClock();
}
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

function writeClock() {
    let time = moment().format(config.clock.format || "HH:mm")
    if (simpleMode) {
        writeLine(new Uint8Array(Buffer.from(time)), {x: 60, y: 1})
    } else {
        time = time.padStart(time.length + 1)
        writeLine(new Uint8Array(Buffer.from(time)), {x: config.clock.x || 0, y: config.clock.y || 0})
    }
}
function startClock() {
    if (config.clock) {
        writeClock();
        clockEnabled = true;
        clearInterval(clockTimer);
        clockTimer = setInterval(writeClock, 5000)
    }
}
function stopClock() {
    clockEnabled = false;
    clearInterval(clockTimer)
    clockTimer = null;
}
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
    writeLine(lastLine1, {x: 0, y: 0});
    writeLineAuto(lastLine2, {x: 0, y: 2});
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
    res.send(lastLine1);
});
app.get('/setHeader', (req, res) => {
    if (req.query.text && (powerState || (!powerState && config.powerOnWithText))) {
        if (autoHideTimer) {
            clearTimeout(autoHideTimer);
            autoHideTimer = null;
        }
        const textValue = req.query.text;
        lastLine1 = textValue;
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
        if (config.autoHideSec || req.query.timeout && !req.query.keepAwake) {
            autoHideTimer = setTimeout(autoHide, ((req.query.timeout) ? parseInt(req.query.timeout.toString()) : config.autoHideSec) * 1000);
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
        if (autoHideTimer) {
            clearTimeout(autoHideTimer);
            autoHideTimer = null;
        }
        const textValue = req.query.text;
        lastLine2 = textValue;
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
        if (config.autoHideSec || req.query.timeout && !req.query.keepAwake) {
            autoHideTimer = setTimeout(autoHide, ((req.query.timeout) ? parseInt(req.query.timeout.toString()) : config.autoHideSec) * 1000);
        }
    } else {
        res.status(400).send('The query "text" is required!');
    }
})
app.get('/setBoth', (req, res) => {
    if (req.query.header && req.query.status && (powerState || (!powerState && config.powerOnWithText))) {
        if (autoHideTimer) {
            clearTimeout(autoHideTimer);
            autoHideTimer = null;
        }
        const header = req.query.header;
        const status = req.query.status;
        lastLine1 = header;
        lastLine2 = status;
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
        if (config.autoHideSec || req.query.timeout && !req.query.keepAwake) {
            autoHideTimer = setTimeout(autoHide, ((req.query.timeout) ? parseInt(req.query.timeout.toString()) : config.autoHideSec) * 1000);
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

if (config.enableAPI) {
    app.listen(apiPort, () => {
        console.log(`Listening at http://0.0.0.0:${apiPort}`);
    });
}
