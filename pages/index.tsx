import * as React from 'react';

import { Box, Container, IconButton, List, Option, Select, Sheet, Stack, Typography, useColorScheme, useTheme } from '@mui/joy';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import Face6Icon from '@mui/icons-material/Face6';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import SmartToyTwoToneIcon from '@mui/icons-material/SmartToyTwoTone';

import { ChatApiInput } from './api/chat';
import { Composer } from '../components/Composer';
import { GptChatModels, SystemPurposeId, SystemPurposes, useSettingsStore } from '../utilities/store';
import { Message, UiMessage } from '../components/Message';
import { NoSSR } from '../components/util/NoSSR';
import { isValidOpenAIApiKey, Settings } from '../components/Settings';

/// UI Messages configuration

const MessageDefaults: { [key in UiMessage['role']]: Pick<UiMessage, 'role' | 'sender' | 'avatar'> } = {
  system: {
    role: 'system',
    sender: 'Bot',
    avatar: SmartToyTwoToneIcon, //'https://em-content.zobj.net/thumbs/120/apple/325/robot_1f916.png',
  },
  user: {
    role: 'user',
    sender: 'You',
    avatar: Face6Icon, //https://mui.com/static/images/avatar/2.jpg',
  },
  assistant: {
    role: 'assistant',
    sender: 'Bot',
    avatar: SmartToyOutlinedIcon, // 'https://www.svgrepo.com/show/306500/openai.svg',
  },
};

const createUiMessage = (role: UiMessage['role'], text: string): UiMessage => ({
  uid: Math.random().toString(36).substring(2, 15),
  text: text,
  model: '',
  ...MessageDefaults[role],
});

/// Chat ///

export default function Conversation() {
  const theme = useTheme();
  const { mode: colorMode, setMode: setColorMode } = useColorScheme();

  const { apiKey, chatModelId, systemPurposeId, setSystemPurpose } = useSettingsStore((state) => ({
    apiKey: state.apiKey,
    chatModelId: state.chatModelId,
    systemPurposeId: state.systemPurposeId,
    setSystemPurpose: state.setSystemPurposeId,
  }));
  const [messages, setMessages] = React.useState<UiMessage[]>([]);
  const [disableCompose, setDisableCompose] = React.useState(false);
  const [settingsShown, setSettingsShown] = React.useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  React.useEffect(() => {
    // show the settings at startup if the API key is not present
    if (!!process.env.REQUIRE_USER_API_KEYS && !isValidOpenAIApiKey(apiKey)) setSettingsShown(true);
  }, [apiKey]);

  const handleDarkModeToggle = () => setColorMode(colorMode === 'dark' ? 'light' : 'dark');

  const handleListClear = () => setMessages([]);

  const handleListDelete = (uid: string) => setMessages((list) => list.filter((message) => message.uid !== uid));

  const handleListEdit = (uid: string, newText: string) =>
    setMessages((list) => list.map((message) => (message.uid === uid ? { ...message, text: newText } : message)));

  const handleListRunAgain = (uid: string) => {
    // take all messages until we get to uid, then remove the rest
    const uidPosition = messages.findIndex((message) => message.uid === uid);
    if (uidPosition === -1) return;
    const conversation = messages.slice(0, uidPosition + 1);
    setMessages(conversation);

    // disable the composer while the bot is replying
    setDisableCompose(true);
    getBotMessageStreaming(conversation).then(() => setDisableCompose(false));
  };

  const handlePurposeChange = (purpose: SystemPurposeId | null) => {
    if (!purpose) return;

    if (purpose === 'Custom') {
      const systemMessage = prompt('Enter your custom AI purpose', SystemPurposes['Custom'].systemMessage);
      SystemPurposes['Custom'].systemMessage = systemMessage || '';
    }

    setSystemPurpose(purpose);
  };

  const getBotMessageStreaming = async (messages: UiMessage[]) => {
    const payload: ChatApiInput = {
      apiKey: apiKey,
      model: chatModelId,
      messages: messages.map(({ role, text }) => ({
        role: role,
        content: text,
      })),
    };

    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (response.body) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      const newBotMessage: UiMessage = createUiMessage('assistant', '');

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const messageText = decoder.decode(value);
        newBotMessage.text += messageText;

        // there may be a JSON object at the beginning of the message, which contains the model name (streaming workaround)
        if (!newBotMessage.model && newBotMessage.text.startsWith('{')) {
          const endOfJson = newBotMessage.text.indexOf('}');
          if (endOfJson > 0) {
            const json = newBotMessage.text.substring(0, endOfJson + 1);
            try {
              const parsed = JSON.parse(json);
              newBotMessage.model = parsed.model;
              newBotMessage.text = newBotMessage.text.substring(endOfJson + 1);
            } catch (e) {
              // error parsing JSON, ignore
              console.log('Error parsing JSON: ' + e);
            }
          }
        }

        setMessages((list) => {
          // if missing, add the message at the end of the list, otherwise set a new list anyway, to trigger a re-render
          const message = list.find((message) => message.uid === newBotMessage.uid);
          return !message ? [...list, newBotMessage] : [...list];
        });
      }
    }
  };

  const handleComposerSendMessage: (text: string) => void = (text) => {
    // seed the conversation with a 'system' message
    const conversation = [...messages];
    if (!conversation.length) {
      const systemMessage = SystemPurposes[systemPurposeId].systemMessage.replaceAll('{{Today}}', new Date().toISOString().split('T')[0]);
      conversation.push(createUiMessage('system', systemMessage));
    }

    // add the user message
    conversation.push(createUiMessage('user', text));

    // update the list of messages
    setMessages(conversation);

    // disable the composer while the bot is replying
    setDisableCompose(true);
    getBotMessageStreaming(conversation).then(() => setDisableCompose(false));
  };

  const noMessages = !messages.length;

  return (
    <Container
      maxWidth="xl"
      disableGutters
      sx={{
        boxShadow: theme.vars.shadow.lg,
      }}
    >
      <Stack
        direction="column"
        sx={{
          minHeight: '100vh',
        }}
      >
        {/* Application Bar */}
        <Sheet
          variant="solid"
          invertedColors
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 20,
            p: 1,
            background: process.env.NODE_ENV === 'development' ? theme.vars.palette.danger.solidHoverBg : theme.vars.palette.primary.solidHoverBg,
            display: 'flex',
            flexDirection: 'row',
          }}
        >
          <IconButton variant="plain" color="neutral" onClick={handleDarkModeToggle}>
            <DarkModeIcon />
          </IconButton>

          {/*{!isEmpty && (*/}
          {/*  <IconButton variant='plain' color='neutral' disabled={isDisabledCompose} onClick={onClearConversation}>*/}
          {/*    <DeleteOutlineOutlinedIcon />*/}
          {/*  </IconButton>*/}
          {/*)}*/}

          <Typography
            sx={{
              textAlign: 'center',
              fontFamily: theme.vars.fontFamily.code,
              fontSize: '1rem',
              lineHeight: 1.75,
              my: 'auto',
              flexGrow: 1,
            }}
            onDoubleClick={handleListClear}
          >
            <NoSSR>
              {GptChatModels[chatModelId]?.title || 'Select Model'} <span style={{ opacity: 0.5 }}> ·</span> {SystemPurposes[systemPurposeId].title}
            </NoSSR>
          </Typography>

          <IconButton variant="plain" color="neutral" onClick={() => setSettingsShown(true)}>
            <SettingsOutlinedIcon />
          </IconButton>
        </Sheet>

        {/* Chat */}
        <Box
          sx={{
            flexGrow: 1,
            background: theme.vars.palette.background.level1,
          }}
        >
          {noMessages ? (
            <Stack direction="column" sx={{ alignItems: 'center', justifyContent: 'center', minHeight: '50vh' }}>
              <Box>
                <Typography level="body3" color="neutral">
                  AI purpose
                </Typography>
                <NoSSR>
                  <Select value={systemPurposeId} onChange={(e, v) => handlePurposeChange(v)} sx={{ minWidth: '40vw' }}>
                    {Object.keys(SystemPurposes).map((spId) => (
                      <Option key={spId} value={spId}>
                        {SystemPurposes[spId as SystemPurposeId]?.title}
                      </Option>
                    ))}
                  </Select>
                  <Typography level="body2" sx={{ mt: 2, minWidth: 260 }}>
                    {SystemPurposes[systemPurposeId].description}
                  </Typography>
                </NoSSR>
              </Box>
            </Stack>
          ) : (
            <>
              <List sx={{ p: 0 }}>
                {messages.map((message) => (
                  <Message
                    key={'msg-' + message.uid}
                    uiMessage={message}
                    onDelete={() => handleListDelete(message.uid)}
                    onEdit={(newText) => handleListEdit(message.uid, newText)}
                    onRunAgain={() => handleListRunAgain(message.uid)}
                  />
                ))}
                <div ref={messagesEndRef}></div>
              </List>
            </>
          )}
        </Box>

        {/* Compose */}
        <Box
          sx={{
            position: 'sticky',
            bottom: 0,
            zIndex: 10,
            background: theme.vars.palette.background.body,
            borderTop: '1px solid',
            borderTopColor: theme.vars.palette.divider,
            p: { xs: 1, md: 2 },
          }}
        >
          <NoSSR>
            <Composer isDeveloper={systemPurposeId === 'Developer'} disableSend={disableCompose} sendMessage={handleComposerSendMessage} />
          </NoSSR>
        </Box>
      </Stack>

      {/* Settings Modal */}
      <Settings open={settingsShown} onClose={() => setSettingsShown(false)} />
    </Container>
  );
}
