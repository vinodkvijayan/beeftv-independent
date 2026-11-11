# ComfyUI

Connect ComfyUI on your own computer or LAN to BeefTV. The workflow saved in ComfyUI is the model in BeefTV: select it on the canvas, write prompt words, and connect reference pictures. When generating, your ComfyUI will run it, and the result will automatically return to the canvas.

## Connect to ComfyUI

1. Start ComfyUI. The default address is `http://127.0.0.1:8188`. When ComfyUI is on another computer, add `--listen` when starting it, and fill in the LAN IP of that computer as the address.
2. Open "Model Configuration" in BeefTV, click "Add Model Service", and select "ComfyUI" in "Select Service Provider".
3. Fill in the address of ComfyUI in "Service Address". No need to fill in the key.
4. Click "Read Model", check the workflow you want to use, and click "Save and Use".

When reading the model, all workflows saved in the ComfyUI "Workflow" panel are listed. The one that saves the video at the end of the workflow is considered a video model; the one that saves pictures is considered a picture model; the one that only saves audio is considered an audio model. Workflows that save nothing will not be listed.

## How to receive prompt words and materials in workflow

**Use App Mode to select the input (recommended)**. Switch the workflow to App Mode in ComfyUI, select the input to be filled in by others and the output to be displayed, and then save. BeefTV will:

- Fill in the prompt word into the first text input you choose;
- Fill in the images, videos, and audios connected to the canvas into the "Load Image/Video/Audio" node of your choice in order;
- Only take the results of the output node you selected.

**Search automatically when App Mode is not set**:

- The prompt word is filled in the text node connected to the `positive` port of the sampler; the reverse prompt word maintains the original content in the workflow.
- Reference materials are filled in all "Load Image/Video/Audio" nodes in order of node number.
- Get the results of all nodes that save or preview images, videos, and audios.

When there are fewer reference materials than what the workflow can accept, the extra loading nodes use the files originally selected in the workflow; when there are more reference materials than what can be accessed, the generation will fail and indicate how many can be accessed.

A new random seed will be replaced every time it is generated, otherwise ComfyUI will directly return the last result for the same input. Except for setting the seed to "fixed" in ComfyUI.

## FAQ

- **It says it cannot connect to ComfyUI**: Confirm that ComfyUI has been started and the address and port are filled in correctly. When ComfyUI is on another computer, use `--listen` to start it.
- **Says missing node**: The custom node used in the workflow is not installed on this ComfyUI. After installing it with ComfyUI Manager, restart ComfyUI and generate it again.
- **Changed the workflow**: Just save it in ComfyUI, and the latest saved version will be used for the next generation. After changing the file name or adding a new workflow, return to the service in "Model Configuration" and click "Read Model".
- **Cancel generation**: Cancellation in BeefTV just stops waiting for the result, and the task in ComfyUI will continue to be completed. To stop the ComfyUI task, please cancel it in the ComfyUI queue.

The reference image will be uploaded to the `input/beeftv` folder of ComfyUI.

## License

Apache-2.0。工作流格式转换改写自 [Node Banana](https://github.com/shrimbly/node-banana)（MIT），见 `THIRD_PARTY_NOTICES.md`。
