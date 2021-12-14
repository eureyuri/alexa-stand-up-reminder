/* *
 * This sample demonstrates handling intents from an Alexa skill using the Alexa Skills Kit SDK (v2).
 * Please visit https://alexa.design/cookbook for additional examples on implementing slots, dialog management,
 * session persistence, api calls, and more.
 * */
const Alexa = require('ask-sdk-core');
const persistenceAdapter = require('ask-sdk-s3-persistence-adapter');
const rp = require('request-promise');
const moment = require('moment-timezone');

let STUDY_LOOP = 0
let ALERTS = []
let ACCESS_TOKEN

const i18n = require('i18next');
const sprintf = require('i18next-sprintf-postprocessor');
const languageStrings = require('./languageStrings');


const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'LaunchRequest';
    },
    handle(handlerInput) {
        ACCESS_TOKEN = handlerInput.requestEnvelope.context.System.user.permissions && handlerInput.requestEnvelope.context.System.user.permissions.consentToken;
        console.log(ACCESS_TOKEN);
    
        if(!ACCESS_TOKEN) {
          return handlerInput.responseBuilder
              .speak('Welcome to the stand up reminder. You need to enable reminders permissions in the Alexa app so we can send you reminders. I just sent you a card in the Alexa app to do this')
              .withAskForPermissionsConsentCard(['alexa::alerts:reminders:skill:readwrite'])
              .getResponse();
        }
        
        const speakOutput = 'Welcome to the stand up reminder. A round consists of a 45 minute work session followed by a 5 minute break. How many rounds would you like to schedule?';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const createAlerts = async (handlerInput) => {
    // Empty array in case of reschedule
    ALERTS = []
    
    // For life time rounds data
    const attributesManager = handlerInput.attributesManager;
    const sessionAttributes = await attributesManager.getPersistentAttributes() || {};
    let roundsTotal = sessionAttributes.hasOwnProperty('rounds') ? sessionAttributes.rounds : 0;
    let roundsMilestone = false

    let alertRest = {}
    let alertResume = {}
    let resumeText = ''
    // Time now
    let alertTime = moment().tz('America/New_York');
    
    // Generate alarms for standing up and resuming work for STUDY_LOOP rounds 
    for (let i = 0; i < STUDY_LOOP; i++) {
        roundsTotal++;
        roundsMilestone = roundsMilestone || (roundsTotal % 10 === 0);
        
        // Alert for reminding to stand up
        alertTime = alertTime.add(45, 'minutes') // FIXME: 45min
        alertRest.trigger = {
          type: 'SCHEDULED_ABSOLUTE',
          timeZoneId: 'America/New_York',
          scheduledTime : alertTime.format('YYYY-MM-DDTHH:mm:ss.000'),
        };
        
        const requestAttributes = handlerInput.attributesManager.getRequestAttributes();
        const randomEnc = requestAttributes.t('ENCS');
        const randomAct = requestAttributes.t('ACTS');
        const speakOutput = randomEnc + requestAttributes.t('GET_ACT_MESSAGE') + randomAct;

        alertRest.alertInfo = {
          spokenInfo: {
            content: [{
                locale: "en-US",
                text: speakOutput,
            }]
          }
        };
        alertRest.pushNotification = {
          status: 'ENABLED'
        };
        
        // Alert for resuming to work 
        if (i === STUDY_LOOP - 1) {
            resumeText = 'Good work! You worked for ' + STUDY_LOOP + ' rounds. You should take a longer break! Relaunch our skill when you want to continue!'
            if (roundsMilestone) {
                resumeText = resumeText + ' Also, you surpassed ' + (Math.floor(roundsTotal / 10) * 10) + ' rounds in total. Congratulations!'
            }
        }
        else resumeText = 'That\'s 5 minutes. Resume working.'
        
        alertTime = alertTime.add(5, 'minutes') // FIXME: 5min
        alertResume.trigger = {
          type: 'SCHEDULED_ABSOLUTE',
          timeZoneId: 'America/New_York',
          scheduledTime : alertTime.format('YYYY-MM-DDTHH:mm:ss.000'),
        };
        alertResume.alertInfo = {
          spokenInfo: {
            content: [{
                locale: "en-US",
                text: resumeText
            }]
          }
        };
        alertResume.pushNotification = {
          status: 'ENABLED'
        };
        
        ALERTS.push(JSON.parse(JSON.stringify(alertRest)))
        ALERTS.push(JSON.parse(JSON.stringify(alertResume)))
    }
    
    let totalRoundsAttribute = {
        rounds: roundsTotal
    }
    attributesManager.setPersistentAttributes(totalRoundsAttribute);
    await attributesManager.savePersistentAttributes();
}

const sendAlerts = async (alerts, handlerInput) => {
    // Post the reminder
    let result, params
    
    alerts.forEach(async alert => {
        params = {
            url: handlerInput.requestEnvelope.context.System.apiEndpoint + '/v1/alerts/reminders',
            method: 'POST',
            headers: {
                'Authorization': 'bearer ' + ACCESS_TOKEN,
            },
            json: alert,
        };
        try {
            result = await rp(params);
            // ALERT_IDS.push(result.alertToken)
        } catch (e) {
            // If scheduling error, reset the lifetime rounds
            const sessionAttributes = await handlerInput.attributesManager.getPersistentAttributes() || {};
            let roundsTotal = sessionAttributes.hasOwnProperty('rounds') ? sessionAttributes.rounds : 0;
            roundsTotal -= STUDY_LOOP;
            
            let totalRoundsAttribute = {
                rounds: roundsTotal
            }
            handlerInput.attributesManager.setPersistentAttributes(totalRoundsAttribute);
            await handlerInput.attributesManager.savePersistentAttributes();
            
            console.log(`=====Error: ${e}`)
            return handlerInput.responseBuilder
                .speak('Sorry, there was an error scheduling')
                .getResponse();
        }
    })
}

const CreateReminderIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'NumberOfRoundsIntent';
    },
    async handle(handlerInput) {
        STUDY_LOOP = handlerInput.requestEnvelope.request.intent.slots.rounds.value;
        
        await createAlerts(handlerInput);
        
        const speakOutput = `Would you like me to set ${STUDY_LOOP} rounds?`;
        
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const ScheduleReminderIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.YesIntent';
    },
    async handle(handlerInput) {
        await sendAlerts(ALERTS, handlerInput)
        
        return handlerInput.responseBuilder
            .speak('Great! I have set you a reminder in 45 minutes. You can start working now!')
            .getResponse();
    }
}

const ChangeReminderIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.NoIntent';
    },
    async handle(handlerInput) {
        const speakOutput = 'How many rounds would you like to schedule?'
        
        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
}

const HelpIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.HelpIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'A round consists of a 45 minute work session followed by a 5 minute break. You can schedule a number of rounds with me to remind you. How many rounds would you like to schedule?';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const CancelAndStopIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && (Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.CancelIntent'
                || Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.StopIntent');
    },
    handle(handlerInput) {
        const speakOutput = 'Goodbye!';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .getResponse();
    }
};
/* *
 * FallbackIntent triggers when a customer says something that doesn’t map to any intents in your skill
 * It must also be defined in the language model (if the locale supports it)
 * This handler can be safely added but will be ingnored in locales that do not support it yet 
 * */
const FallbackIntentHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest'
            && Alexa.getIntentName(handlerInput.requestEnvelope) === 'AMAZON.FallbackIntent';
    },
    handle(handlerInput) {
        const speakOutput = 'Sorry, I don\'t know about that. Please try again.';

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};
/* *
 * SessionEndedRequest notifies that a session was ended. This handler will be triggered when a currently open 
 * session is closed for one of the following reasons: 1) The user says "exit" or "quit". 2) The user does not 
 * respond or says something that does not match an intent defined in your voice model. 3) An error occurs 
 * */
const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.log(`~~~~ Session ended: ${JSON.stringify(handlerInput.requestEnvelope)}`);
        // Any cleanup logic goes here.
        return handlerInput.responseBuilder.getResponse(); // notice we send an empty response
    }
};
/* *
 * The intent reflector is used for interaction model testing and debugging.
 * It will simply repeat the intent the user said. You can create custom handlers for your intents 
 * by defining them above, then also adding them to the request handler chain below 
 * */
const IntentReflectorHandler = {
    canHandle(handlerInput) {
        return Alexa.getRequestType(handlerInput.requestEnvelope) === 'IntentRequest';
    },
    handle(handlerInput) {
        const intentName = Alexa.getIntentName(handlerInput.requestEnvelope);
        const speakOutput = `You just triggered ${intentName}`;

        return handlerInput.responseBuilder
            .speak(speakOutput)
            //.reprompt('add a reprompt if you want to keep the session open for the user to respond')
            .getResponse();
    }
};
/**
 * Generic error handling to capture any syntax or routing errors. If you receive an error
 * stating the request handler chain is not found, you have not implemented a handler for
 * the intent being invoked or included it in the skill builder below 
 * */
const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        const speakOutput = 'Sorry, I had trouble doing what you asked. Please try again.';
        console.log(`~~~~ Error handled: ${JSON.stringify(error)}`);

        return handlerInput.responseBuilder
            .speak(speakOutput)
            .reprompt(speakOutput)
            .getResponse();
    }
};

const RequestInterceptor = {
  process(handlerInput) {
    const requestClient = i18n.use(sprintf).init({
      lng: handlerInput.requestEnvelope.request.locale,
      fallbackLng: 'en', // fallback to EN if locale doesn't exist
      resources: languageStrings
    });

    requestClient.randomize = function () {
      const args = arguments;
      let values = [];

      for (var i = 1; i < args.length; i++) {
        values.push(args[i]);
      }
      const value = i18n.t(args[0], {
        returnObjects: true,
        postProcess: 'sprintf',
        sprintf: values
      });

      if (Array.isArray(value)) {
        return value[Math.floor(Math.random() * value.length)];
      } else {
        return value;
      }
    }

    const attributes = handlerInput.attributesManager.getRequestAttributes();
    attributes.t = function (...args) { // pass on arguments to the requestClient
      return requestClient.randomize(...args);
    };
  },
};

/**
 * This handler acts as the entry point for your skill, routing all request and response
 * payloads to the handlers above. Make sure any new handlers or interceptors you've
 * defined are included below. The order matters - they're processed top to bottom 
 * */
exports.handler = Alexa.SkillBuilders.custom()
    .withPersistenceAdapter(
        new persistenceAdapter.S3PersistenceAdapter({bucketName:process.env.S3_PERSISTENCE_BUCKET}))
    .addRequestHandlers(
        LaunchRequestHandler,
        CreateReminderIntentHandler,
        ScheduleReminderIntentHandler,
        ChangeReminderIntentHandler,
        HelpIntentHandler,
        CancelAndStopIntentHandler,
        FallbackIntentHandler,
        SessionEndedRequestHandler,
        IntentReflectorHandler)
    .addErrorHandlers(ErrorHandler)
    .addRequestInterceptors(RequestInterceptor)
    .withCustomUserAgent('sample/hello-world/v1.2')
    .withApiClient(new Alexa.DefaultApiClient())
    .lambda();