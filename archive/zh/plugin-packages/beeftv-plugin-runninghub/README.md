# RunningHub Plugin

Connect [RunningHub](https://www.runninghub.cn) to BeefTV. Your workflow and AI applications on RunningHub are models in BeefTV. The canvas and creation page can use them to directly generate images, videos and audios, and you can also bring reference materials.

RunningHub's API is only open to individual members and above, and the generated fees are settled by RunningHub according to your account.

## Get started

1. Install "RunningHub" in the plug-in center.
2. Open **Model Configuration → Add Model Service**, select RunningHub, and fill in the API Key. Overseas stations change the service address to `https://www.runninghub.ai`.
3. Click "Manually add model", add the workflow or AI application you want to use, and select the type of output (image, video or audio) next to it:
   - Workflow: fill in the number, or directly paste the web link.
   - AI application: Add `app:` before the number, such as `app:1937084629516193794`, or directly paste the web link.

RunningHub does not have an interface to list workflows using API Key, so "Read Model" cannot read the list and needs to be added manually.

## How does it fill in the parameters?

- Workflow: Fill in the prompt word into the text node connected to the `positive` port of the sampler, fill in the reference material into the "Load Image/Video/Audio" node in sequence according to the node number, and change the seed each time.
- AI Application: Only fill in the fields disclosed by the author. Prompt words are filled in text fields named like prompt words; if there is only one text field, fill it in.
- When the given materials are less than the positions, the files originally selected in the workflow will be used for the remaining positions. If you give more than the position, an error will be reported directly.

## FAQ

**说模型要填编号**：模型列表里只能填工作流编号、`app:编号` 或网页链接。

**Doesn't recognize this API Key**: Go to RunningHub's API console to copy the Key and confirm that the account is an individual member or above.

**Workflow cannot run**: RunningHub requires the workflow to run successfully on the web page once before it can be called using API.

**Prompt word not used**: The forward prompt word node cannot be found in the workflow, or the AI application does not have a public text field.