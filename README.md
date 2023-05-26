# A Marverlous Display
A Simple Controller for a "Futaba VFD Serial Display" that is used in a very Marvelous game

## Configuration
```json
{
    "serialPort": "COM50",
    "enableAPI": true,
    "autoStart": true,
    "autoHideSec": 15,
    "autoShutdownDisplayMin": 300, 
    "powerOnWithText": true,
    "clock": {
        "x": 110,
        "y": 2,
        "format": "HH:mm"
    },
    "initBrightness": 1,
    "wakeUpBrightness": 3,
    "initLine1": "PlayLand Gau",
    "initLine2": "Hello World, this is a default scroll line!"
}
```
* serialPort: COM Port or Path
* apiPort: API Port
* enableAPI: Enable API Endpoints
* autoStart: Enable Auto Power On
* autoHideSec: Auto Dim Display and Show Only Clock after Timer in seconds
* autoShutdownDisplayMin: Auto Power Off Display Timer in minutes
* powerOnWithText: Power On Display when off to display message
* clock: Sets Clock Position, if removed the clock is disabled and can not be used
* initBrightness: Initial Brightness of Display
* wakeUpBrightness: Brightness of Display when a line is written from simple mode
* initLine1/initLine2: Initial Line 1 and 2

## API Endpoints
### Device Commands
#### Power On - /powerOn
* brightness = 1-3 Integer Low to Max Phosphor Intensity

Enable Power Supply

#### Power Off - /powerOff
Disable Power Supply, useful to prevent burn in

#### Power State - /powerState
Returns "true" or "false" if power is enabled

#### Reset - /reset
* brightness = 1-3 Integer Low to Max Phosphor Intensity

Resets the Display, Does not set any data<br/>
Useful if you want to briefly show custom messages with setText

#### Reload - /reload
Exits standby and writes last display lines

#### Standby Clock - /standby
Jump to standby clock

#### Wake up Display - /wakeUp
* timeout = Integer in seconds before returning to standby clock

Leaves standby and shows last display lines, will return to standby after timeout

#### Enable Clock - /enableClock
Enable Clock Display and Updates

#### Disable Clock - /disableClock
Disable Clock Display and Updates

### Text Writing
#### Set Line 1 - /setHeader
* text = Text to display (No Auto Scroll Detection)
* brightness = 1-3 Integer Low to Max Phosphor Intensity
* temp = Do not save text to memory (Useful for notifying of messages)
* timeout = Integer in seconds before returning to standby clock
* keepAwake = true, Keeps display on regardless of the auto hide

```
LINE 1 <-
LINE 2    CLOCK
```

#### Set Line 2 - /setStatus
* text = Text to display (Auto Scroll Detection)
* brightness = 1-3 Integer Low to Max Phosphor Intensity
* temp = Do not save text to memory (Useful for notifying of messages)
* timeout = Integer in seconds before returning to standby clock
* keepAwake = true, Keeps display on regardless of the auto hide

```
LINE 1 
LINE 2 <- CLOCK
```

#### Set Both Lines - /setBoth
* header = Line 1 Text to display
* status = Line 2 Text to display (Auto Scroll Detection)
* brightness = 1-3 Integer Low to Max Phosphor Intensity
* temp = Do not save text to memory (Useful for notifying of messages)
* timeout = Integer in seconds before returning to standby clock
* keepAwake = true, Keeps display on regardless of the auto hide

```
LINE 1 <-
LINE 2 <- CLOCK
```

#### Set Text Manually - /setText
* text = Text to display (Auto Scroll Detection)
* x = Column
* y = Row (0-2)
* charset = Character Language to ues
* clear = Clear this line before writing
* brightness = 1-3 Integer Low to Max Phosphor Intensity
* temp = Do not save text to memory (Useful for notifying of messages)
* timeout = Integer in seconds before returning to standby clock

Sets text in any position

#### Set Scroll Manually - /setScroll
* text = Text to display (Auto Scroll Detection)
* x = Column
* y = Row (0-2)
* width = Width of scroll box
* speed = Speed of scroll
* padding = Padding of end of text
* charset = Character Language to ues
* clear = Clear this line before writing
* brightness = 1-3 Integer Low to Max Phosphor Intensity
* temp = Do not save text to memory (Useful for notifying of messages)
* timeout = Integer in seconds before returning to standby clock

Sets text in any position

### Message Queueing
You can send "messages" to the API and add them to a stack that can be displayed and dismissed with a HTTP Button
#### Display a message - /addMessage
* header = Line 1 Text to display
* status = Line 2 Text to display (Auto Scroll Detection)

Display will be wakened up and message will be displayed without timeout until you dismiss the message

#### Dismiss the message - /nextMessage
Dismiss the message and display the next message or return to the display mode
