#Save settings

The "Storage Settings" in the desktop settings provide local directory migration, user's own reference material object storage and depth capture component management in turn.

## Local directory

The default directory is still BeefTV under the system user configuration directory (usually `%AppData%\BeefTV` on Windows). Select an empty folder, such as `D:\BeefTV`, and click "Migrate old data and use new directory". After the application closes the services, background tasks, and SQLite in the current workspace, copy and verify the database, materials, model configurations, encryption keys, plug-ins, and local model cache, and then open the new directory. It stops when the target already has files, directories overlap, there is insufficient space, or verification fails; the original data is retained.

Directory selection records are always saved in the default configuration directory at `storage-location.json`, so restarts and upgrades can find the selected disks. If the selected disk is not connected, an error will be reported at startup and an empty workspace will not be created. CLI autodiscovery uses the same record; explicit startup parameters `--data-dir` or environment variables still take precedence. The process of fixing the directory through `CANVAS_DESKTOP_DATA_DIR` must first remove this variable before using the interface migration.

After confirming that the projects, materials, and models in the new workspace are configured normally, you can click "Clear the original directory to free up disk space." Cleaning will check the original file again; cleaning will be refused when there are new additions or modifications. A small record is kept in the default directory for locating new disks. The new version uses file locks to prevent the same directory from being opened by multiple instances; it also checks for legacy instances that are still running before migrating. Don't launch legacy apps during migration or cleanup.

The update download is placed in the selected directory `cache/updates`, and the temporary files for backend processing are placed in `cache/tmp`. `cache/tmp` does not participate in migration and migration space estimation, and the temporary directory will be re-created in the new directory; other cached and `.tmp` files outside the directory are still fully copied and verified. If the temporary files are still occupied when cleaning the original directory, the cleaning record will be retained, and you can clean it again after restarting BeefTV. Installation volume space required for program installation, update replacement, and system-managed WebView cache are outside the scope of this migration. Browsers that do not commit drafts retain the original browser cache namespace and do not treat it as a separate backup.

迁移方式参考 [Zotero 数据目录管理](https://www.zotero.org/support/zotero_data)：先停止写入、验证副本，保留原数据，成功后切换持久目录。没有复制 Zotero 代码。

## User's own object storage

In the model configuration of the custom channel, "reference material transmission" can be set separately for images, videos and audios. By default, it is processed according to the protocol; "Directly upload material" uses the file of this protocol or Base64 input, which requires the support of the service provider; "Upload to my object storage" uploads the local material first; "Manually fill in the HTTPS link" will not automatically upload. The material upload process provided by the service provider is still handled by the corresponding protocol.

The Wanxiang video protocol allows images to use Base64, and reference video and audio still require online links. Third-party compatible interfaces may have different requirements and settings can be overridden under this model. The Agnes image protocol also supports Base64 reference images, and the need for object storage cannot be determined based on the brand name.

"Save and test upload" saves the current configuration, uploads a temporary small picture, checks anonymous reading and deletes the test file. If it succeeds, it will show that all three steps have been passed; if it fails, it will show the specific reason. The test does not call the model, and the storage service may charge a small request fee. The successful saving of the configuration itself does not mean that the upload is available.

Use the S3 compatible interface to fill in the endpoint, bucket name, region, Access Key ID, Secret Access Key and the read address corresponding to the bucket. The R2 region uses `auto`; AWS S3 uses the bucket's actual region; MinIO uses its S3 region and readable ingress. The public network address should correspond to the bucket root directory, and the uploaded object key will be appended to this address. Public endpoints use HTTPS. Native, RFC1918, or CGNAT (`100.64.0.0/10`) endpoints can use HTTP; HTTP will still be rejected as long as there is a public, link-local, unspecified, or multicast address in the parsing result.

Credentials are stored encrypted in the current data directory and remain with the migration. The read configuration interface does not return Secret; leave the form blank to retain the saved key. When changing the Access Key, you must fill in the corresponding Secret. Enabling switches and saving operations is at the user's discretion. The fee is charged by the user's own storage service.

当渠道要求公网参考素材时，应用只复制并上传当前工作区拥有的参考资源。上传使用 [AWS 官方 SigV4 签名库](https://pkg.go.dev/github.com/aws/aws-sdk-go-v2/aws/signer/v4)。随后匿名读取公网链接并核对素材内容前缀。未启用存储或选择手动链接时，画布和创作页引导填写 HTTPS 链接；补齐前不创建生成任务。任务执行阶段上传失败会记录具体素材和原因，保留原任务，不提交模型；可检查存储配置，或将该类型改为手动链接后重新提交。

Requests to disable redirection and continue to use unified outbound connection protection. Endpoints and read addresses cannot contain account passwords or query parameters. By default, HTTP/HTTPS addresses that resolve to the local machine, LAN, or CGNAT are allowed; public addresses must still be HTTPS. Link-local, unassigned, and multicast are still denied. When `CANVAS_ALLOW_PRIVATE_UPSTREAMS=false` is explicitly set, only public network HTTPS is accepted, and the allow list cannot be changed to HTTP or private network. If the cloud model requires materials that can be pulled from the public network, the LAN address cannot be accessed by the other party even if it passes the verification.

The canvas "Add Material" also supports filling in the HTTPS URL of images, videos or audios. Online materials retain their original URLs to avoid losing upstream readable addresses after downloading local resources. Whether an online link is required depends on the selected protocol and media type.

## Restart recovery and troubleshooting

When reading the old plain text model configuration, atomically encrypt the main configuration and backup, retaining the configuration content and version. When the main configuration of the model is missing, the encryption `.bak` is read first; if the backup is damaged or the key is missing, an error must be reported and the empty configuration will not be overwritten. Failure to read the project list or details will display "The project cannot be read temporarily" and try again. The existing cache will be retained, and the automatic opening process will not create an empty project.

These fixes cover reproducible code issues and do not replace on-site diagnosis by feedback users. The desensitization record should be exported from the device's "Problem Diagnosis" to check the version, actual data directory, disk space, database and configuration health status; do not send the configuration body or `.settings-key`.