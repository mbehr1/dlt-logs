# Change log for 'DLT-Logs': ([documentation](https://mbehr1.github.io/dlt-logs))

## [1.27.0](https://github.com/mbehr1/dlt-logs/compare/v1.26.5...v1.27.0) (2022-04-20)


### Features

* **adlt:** add semver version check for adlt ([cf3b539](https://github.com/mbehr1/dlt-logs/commit/cf3b539c3954fca42c4b50ca446250063402b157))
* **adlt:** apid/ctid info for hover and add/edit filter ([e8c239f](https://github.com/mbehr1/dlt-logs/commit/e8c239f889a1c2aa68210fe08d124bb701ee4d91))
* **adlt:** autostart adlt on doc open ([a8b4748](https://github.com/mbehr1/dlt-logs/commit/a8b474879bc75a10c73f01990fcdfeb05637d438))
* **adlt:** filters autoloaded and decorations ([8e412a7](https://github.com/mbehr1/dlt-logs/commit/8e412a781b28c02b3e08041a6d8a744d559b380f))
* **adlt:** first apid/ctids ([aa86a63](https://github.com/mbehr1/dlt-logs/commit/aa86a63f7f555c9c8f4eeb4913b8f79709766c4a))
* **adlt:** jump to lc start on tree view selection ([9ae1fa8](https://github.com/mbehr1/dlt-logs/commit/9ae1fa80c4e3f7a163e4003746783fff99fcbe87))
* **adlt:** lifecycles and filtering for them ([0de92a5](https://github.com/mbehr1/dlt-logs/commit/0de92a5f92ea34bc7d9ffd363ab79405b1a89e58))
* **adlt:** lineCloseToDate / jump to line by time ([059401d](https://github.com/mbehr1/dlt-logs/commit/059401d488db6b10f944811ce97e4a2461ac00be))
* **adlt:** plugin state support ([f075173](https://github.com/mbehr1/dlt-logs/commit/f075173e0b2ed6fb6388453725677cfaff05e1bd))
* **adlt:** show adlt remote version in status bar ([aea0b68](https://github.com/mbehr1/dlt-logs/commit/aea0b684a0a60e7b5770488fd289ca136cb9f50c))
* **adlt:** show nr msgs for apids/ctids ([c80920e](https://github.com/mbehr1/dlt-logs/commit/c80920e66201862a9dc643445b4b24376335b1a2))
* **adlt:** show sw version for the lifecycles ([69f8283](https://github.com/mbehr1/dlt-logs/commit/69f8283006915e738c8d11dae45d73554ad6cbcf))
* add plugins via adlt ([968bf62](https://github.com/mbehr1/dlt-logs/commit/968bf62254ca9575f3d873c4d4d266901084d4d7))
* distribute selected time to reports ([aa5efd8](https://github.com/mbehr1/dlt-logs/commit/aa5efd83aff92cf0ca95b30ac103a2444e1a751f))
* **adlt:** support opening of multiple files ([a7d670f](https://github.com/mbehr1/dlt-logs/commit/a7d670f29ca604706a1da05b61e80c3aa52a0a9f))
* **adlt:** toggle sort order ([76f8efd](https://github.com/mbehr1/dlt-logs/commit/76f8efd74cd44c6aa20fe9735e72fcc1504dc7c8))
* poc for adlt ([29efade](https://github.com/mbehr1/dlt-logs/commit/29efade7908a7df6e5d41d3961da126d3423f91e))


### Bug Fixes

* **adlt:** adding a report to an existing one supported ([13eff01](https://github.com/mbehr1/dlt-logs/commit/13eff01eec878b40b0632d35b6347028eb7e3984))
* adjust odd/even lcs according to dlt-log behaviour ([85b478b](https://github.com/mbehr1/dlt-logs/commit/85b478bbc07071403885decf6017ab6f7510a438))
* if no doc is visible use the last visible one for restquery ([daf6272](https://github.com/mbehr1/dlt-logs/commit/daf627294338ac4ac0bda5742d4d79248c680cb8))
* **adlt:** add/editFilter ([f75a810](https://github.com/mbehr1/dlt-logs/commit/f75a810b39d02b34cdcdadd7414e6423e95a9627))
* **adlt:** by config disabled filters are never used ([8692c9f](https://github.com/mbehr1/dlt-logs/commit/8692c9fe481ea93caed3390df371a944b5a9dede))
* **adlt:** decorate lifecycles ([66418d6](https://github.com/mbehr1/dlt-logs/commit/66418d6a0e8f51dea767e69ff0e43655592e7782))
* **adlt:** hover support ([11fef66](https://github.com/mbehr1/dlt-logs/commit/11fef66bc9c2b1e23882ad9d51a8e33cde859efd))
* **adlt:** restQuery use similar format as dlt ([1389f8a](https://github.com/mbehr1/dlt-logs/commit/1389f8a6183fbd6b7ce9b4c9a2e4b6d6dcf6ae81))
* **adlt:** show ... lead to empty file ([ec2276f](https://github.com/mbehr1/dlt-logs/commit/ec2276f32010068ba34782f87440a284fdd6da73))
* **adlt:** update status bar on fileInfo, adltPath config ([363b97c](https://github.com/mbehr1/dlt-logs/commit/363b97ca00d072fd408b438facdf1ed3bfa13080))
* **adlt:** use cached ecu, apid, ctid ([7cae8b3](https://github.com/mbehr1/dlt-logs/commit/7cae8b326667a15ec6c59a133136b47bcf3ee717))
* **adlt:** use changeWindow instead of a new stream ([acb3cc4](https://github.com/mbehr1/dlt-logs/commit/acb3cc43d52458f4e80fab674d199703ee1f3cc2))
* less verbose onDidOpenTextDocument ([a9cdc54](https://github.com/mbehr1/dlt-logs/commit/a9cdc54a474b2078fe7f1b96d1c53963255726dd))
* max_message_size, statusbar errors ([ba1992f](https://github.com/mbehr1/dlt-logs/commit/ba1992fb07bab871765b0cb9eae23b253764627f))
* **adlt:** status bar ([26729d5](https://github.com/mbehr1/dlt-logs/commit/26729d5145823bd8534df5dde7a313ca87755422))
* **adlt:** use only enabled filters ([89d0344](https://github.com/mbehr1/dlt-logs/commit/89d0344d01368b01f9ead0fd44f06d139132a009))
* **hover:** fix markdown table ([7c33742](https://github.com/mbehr1/dlt-logs/commit/7c33742d1256a3cf18555b184008b115cfaacd62))
* textLinesForMsgs access out of bounds ([9619609](https://github.com/mbehr1/dlt-logs/commit/9619609189829d5b1f4aae0c8d3c04c65ca2f877))

### [1.26.5](https://github.com/mbehr1/dlt-logs/compare/v1.26.4...v1.26.5) (2022-02-26)


### Bug Fixes

* **someip:** static array getting no buffer ([e812141](https://github.com/mbehr1/dlt-logs/commit/e812141770b11eea0e9df35b390bdb53a86576ab))

### [1.26.4](https://github.com/mbehr1/dlt-logs/compare/v1.26.3...v1.26.4) (2022-02-26)


### Bug Fixes

* **someip:** impl fixed array size ([14b746b](https://github.com/mbehr1/dlt-logs/commit/14b746b35469591576354431c7d9da024b2f6707))
* **someip:** use unionType as index into members ([e260a8a](https://github.com/mbehr1/dlt-logs/commit/e260a8a7dbcb7b662f585a3b421b2faa1c11594a))

### [1.26.3](https://github.com/mbehr1/dlt-logs/compare/v1.26.2...v1.26.3) (2022-02-26)


### Bug Fixes

* **someip:** support array of unions ([e1629c6](https://github.com/mbehr1/dlt-logs/commit/e1629c6aed18b1b30f62a301e4be9e4ec9eee5e2))

### [1.26.2](https://github.com/mbehr1/dlt-logs/compare/v1.26.1...v1.26.2) (2022-02-26)


### Bug Fixes

* **someip:** limit arrLen to 16bit ([cdfd626](https://github.com/mbehr1/dlt-logs/commit/cdfd6260d98c9b1fdd5ca0a36522cd23539e650d))
* **someip:** remove warnings on untested coding ([8796320](https://github.com/mbehr1/dlt-logs/commit/87963202cc7754122899bd379829ae2f141d5978))

### [1.26.1](https://github.com/mbehr1/dlt-logs/compare/v1.26.0...v1.26.1) (2021-11-15)


### Bug Fixes

* apid/ctid tree view filter for SH ecus ([d8e6ab0](https://github.com/mbehr1/dlt-logs/commit/d8e6ab013e828728c8a4e2bfbc3279837fea452b))

## [1.26.0](https://github.com/mbehr1/dlt-logs/compare/v1.25.2...v1.26.0) (2021-10-19)


### Features

* ship dependencies for reports ([5e1f745](https://github.com/mbehr1/dlt-logs/commit/5e1f7452133545fe4d6101a1498062b8e87b6c34))

### [1.25.2](https://github.com/mbehr1/dlt-logs/compare/v1.25.1...v1.25.2) (2021-07-19)


### Bug Fixes

* **report:** end persisted states at report (last lc) end ([acfdecf](https://github.com/mbehr1/dlt-logs/commit/acfdecff0fdd232bb9e39b220a552735d32872bd))

### [1.25.1](https://github.com/mbehr1/dlt-logs/compare/v1.25.0...v1.25.1) (2021-07-19)


### Bug Fixes

* **report:** persistent timelines chart end at lc ([a62e025](https://github.com/mbehr1/dlt-logs/commit/a62e025d670f93e3c8e0a828a1feec329d79924d))

## [1.25.0](https://github.com/mbehr1/dlt-logs/compare/v1.24.0...v1.25.0) (2021-07-18)


### Features

* **export:** use less memory, filter on pass 1 ([733b76c](https://github.com/mbehr1/dlt-logs/commit/733b76cc381ac9eddba1ce8ad16c7b6f553eb6ae))


### Bug Fixes

* rewrite plugin  allow to change more than text ([a1deee2](https://github.com/mbehr1/dlt-logs/commit/a1deee2009f53ea37585d6e1a0f83886888bf4ef))

## [1.24.0](https://github.com/mbehr1/dlt-logs/compare/v1.23.0...v1.24.0) (2021-07-14)


### Features

* add verbose/non-verbose option for filters ([4659a10](https://github.com/mbehr1/dlt-logs/commit/4659a10ebad0d0ec2f830417f6b884b02fcd96ca))

## [1.23.0](https://github.com/mbehr1/dlt-logs/compare/v1.22.4...v1.23.0) (2021-07-11)


### Features

* thin out data on timeline charts ([f064aea](https://github.com/mbehr1/dlt-logs/commit/f064aea4cbcda9097f38b2699b7c1b03f61b08d9))


### Bug Fixes

* timeline reset zoom only resetting zoom from tl ([0103823](https://github.com/mbehr1/dlt-logs/commit/0103823bf79f18e3c9164cf3947430d9b404da6e))
* timelinechart keep zoom on collapse ([b1e0d5b](https://github.com/mbehr1/dlt-logs/commit/b1e0d5b413732dd2e4a6cb48483d3ae2a945d72e))
* vscode.dev is not yet a trusted svg provider ([a843c26](https://github.com/mbehr1/dlt-logs/commit/a843c26319c9f64d491745118d4dd36f62bfac3a))

### [1.22.4](https://github.com/mbehr1/dlt-logs/compare/v1.22.3...v1.22.4) (2021-07-04)


### Bug Fixes

* report speed up sorting dataset ([6d7a03a](https://github.com/mbehr1/dlt-logs/commit/6d7a03a4eab6bd89506dbc46aac2a6cc7337f0a9))
* time lines chart handling large data set ([690d464](https://github.com/mbehr1/dlt-logs/commit/690d464878d14042297da28d485c796febae1f51))

### [1.22.3](https://github.com/mbehr1/dlt-logs/compare/v1.22.2...v1.22.3) (2021-07-03)


### Bug Fixes

* someipplugin remove a_float32 warning ([b0fefe3](https://github.com/mbehr1/dlt-logs/commit/b0fefe3c9542c54236d405ff4c8e58539d070935))

### [1.22.2](https://github.com/mbehr1/dlt-logs/compare/v1.22.1...v1.22.2) (2021-06-27)


### Bug Fixes

* reduce memory load/usage ([a316f7b](https://github.com/mbehr1/dlt-logs/commit/a316f7b5cb1ab75cac4fa421bee00c00060dc46c))

### [1.22.1](https://github.com/mbehr1/dlt-logs/compare/v1.22.0...v1.22.1) (2021-06-26)


### Bug Fixes

* output of time to load and include heap used ([f98e07f](https://github.com/mbehr1/dlt-logs/commit/f98e07f146831d213e3ff146099ea45eb6378d16))

# Change log for 'DLT-Logs' ([documentation](https://mbehr1.github.io/dlt-logs)):

## [1.22.0](https://github.com/mbehr1/dlt-logs/compare/v1.21.8...v1.22.0) (2021-06-20)


### Features

* welcome or whats new ([0ca9e53](https://github.com/mbehr1/dlt-logs/commit/0ca9e531ec14b488d2871e14b0f8bfd7a10edae4))

### [1.21.8](https://github.com/mbehr1/dlt-logs/compare/v1.21.7...v1.21.8) (2021-06-17)


### Bug Fixes

* timelines avoid destruct error ([91595a6](https://github.com/mbehr1/dlt-logs/commit/91595a61dbd7d6c03f19a04564b82917ef04efa7))

### [1.21.7](https://github.com/mbehr1/dlt-logs/compare/v1.21.6...v1.21.7) (2021-06-13)


### Bug Fixes

* **report:** better collapse function ([44fbc76](https://github.com/mbehr1/dlt-logs/commit/44fbc76b81ec94570be57ef8bdd47bd037a0dc8e))


### Performance Improvements

* avoid evaluating report filters multiple times ([859d01f](https://github.com/mbehr1/dlt-logs/commit/859d01f30b34da3c7a9899124fe273a36ab07b93))

### [1.21.6](https://github.com/mbehr1/dlt-logs/compare/v1.21.5...v1.21.6) (2021-06-12)


### Bug Fixes

* **report:** disabled more logs ([e6b0706](https://github.com/mbehr1/dlt-logs/commit/e6b070628135599dc139ee00bfe7d1edcb45afd6))
* **report:** remove some logging ([a0e230e](https://github.com/mbehr1/dlt-logs/commit/a0e230e9a21d578fe662918497aa6dc72e1f45a7))
* **report:** timeline autocollapse ([461d4ce](https://github.com/mbehr1/dlt-logs/commit/461d4ce3028e0223ce79caed5c2c737aae9a64e5))
* **report:** timeline chart layout changes ([b834ca7](https://github.com/mbehr1/dlt-logs/commit/b834ca76276dca1278d26a473760308a06b4dfef))

### [1.21.5](https://github.com/mbehr1/dlt-logs/compare/v1.21.4...v1.21.5) (2021-06-10)


### Bug Fixes

* support lazy/late eval for TL_ ([fda593b](https://github.com/mbehr1/dlt-logs/commit/fda593bbd13ad38c1df728f9e90e2f6cdb9c4ca6))

### [1.21.4](https://github.com/mbehr1/dlt-logs/compare/v1.21.3...v1.21.4) (2021-06-09)


### Bug Fixes

* treat empty value name as end marker ([10fade7](https://github.com/mbehr1/dlt-logs/commit/10fade7fc49dcd8495d78ddefde1288e2bc28cdf))

### [1.21.3](https://github.com/mbehr1/dlt-logs/compare/v1.21.2...v1.21.3) (2021-06-08)


### Bug Fixes

* use 1ms for finished TL_ events ([adc0541](https://github.com/mbehr1/dlt-logs/commit/adc0541289da90689ff977b5e982b9038dd9a1d0))

### [1.21.2](https://github.com/mbehr1/dlt-logs/compare/v1.21.1...v1.21.2) (2021-06-08)


### Bug Fixes

* add tooltip and color to values ([88b3882](https://github.com/mbehr1/dlt-logs/commit/88b3882be6c50b536cf70bc99b18fcba3adc7fd1))

### [1.21.1](https://github.com/mbehr1/dlt-logs/compare/v1.21.0...v1.21.1) (2021-06-07)


### Bug Fixes

* timeline chart layout changes ([9144d91](https://github.com/mbehr1/dlt-logs/commit/9144d91a78ee85aea9739cf83b1d9f8b49b5efbd))
* timeline margin and tooltip ([fa22370](https://github.com/mbehr1/dlt-logs/commit/fa22370c466b07fd491d0c354d1f311337795d54))

## [1.21.0](https://github.com/mbehr1/dlt-logs/compare/v1.20.1...v1.21.0) (2021-06-06)


### Features

* timeline/swimlane report chart ([a3b6f43](https://github.com/mbehr1/dlt-logs/commit/a3b6f434916ffaaf17280107acc7cea77d2f095c))

### [1.20.1](https://github.com/mbehr1/dlt-logs/compare/v1.20.0...v1.20.1) (2021-05-16)


### Bug Fixes

* build use VSCE_PAT and not VSCE_TOKEN ([4979fd1](https://github.com/mbehr1/dlt-logs/commit/4979fd1e2cb0d6ce5b29455f5470d15a7c74b3a8))

## [1.20.0](https://github.com/mbehr1/dlt-logs/compare/v1.19.0...v1.20.0) (2021-05-16)


### Features

* non-verbose mode support ([de9c570](https://github.com/mbehr1/dlt-logs/commit/de9c570192c7fc394abafbfe098fb2368c7a0b6b))


### Bug Fixes

* width of index column wrong for sort order time ([5c5d683](https://github.com/mbehr1/dlt-logs/commit/5c5d683c9522178f2c0f594f8ae002e5a666ab09))

## [1.19.0](https://github.com/mbehr1/dlt-logs/compare/v1.18.1...v1.19.0) (2021-05-15)


### Features

* allow view to sort by time instead of index ([4f6678a](https://github.com/mbehr1/dlt-logs/commit/4f6678a8039393f5521dfda3104c7d0dbab069ed))

### [1.18.1](https://github.com/mbehr1/dlt-logs/compare/v1.18.0...v1.18.1) (2021-05-14)


### Bug Fixes

* file transfer plugin caused transformation plugins failures ([d4d1602](https://github.com/mbehr1/dlt-logs/commit/d4d16029c8e05dec2928b65a67047282106c4abb))

## [1.18.0](https://github.com/mbehr1/dlt-logs/compare/v1.17.0...v1.18.0) (2021-05-14)


### Features

* **rewrite:** add rewrite plugin ([5bcbedb](https://github.com/mbehr1/dlt-logs/commit/5bcbedbacf23fe662730ab7722ae4e7dd0d14369))

## [1.17.0](https://github.com/mbehr1/dlt-logs/compare/v1.16.2...v1.17.0) (2021-05-13)


### Features

* limited support for untrusted workspaces ([279d1a1](https://github.com/mbehr1/dlt-logs/commit/279d1a18bac431f42b57cce120984f3ff39f7684))

### [1.16.2](https://github.com/mbehr1/dlt-logs/compare/v1.16.1...v1.16.2) (2021-05-09)


### Bug Fixes

* handle non zero terminated payload strings ([5b27f96](https://github.com/mbehr1/dlt-logs/commit/5b27f96f7e676901a68c244a3ddf23754863c058))

### [1.16.1](https://github.com/mbehr1/dlt-logs/compare/v1.16.0...v1.16.1) (2021-05-08)


### Bug Fixes

* **export:** quickpick next button use selection ([2c57763](https://github.com/mbehr1/dlt-logs/commit/2c577635e64877d7a4302da880619ed39c40653c))

## [1.16.0](https://github.com/mbehr1/dlt-logs/compare/v1.15.0...v1.16.0) (2021-05-08)


### Features

* add mtin string to restquery results for msgs ([bc841c0](https://github.com/mbehr1/dlt-logs/commit/bc841c0a7547ea814143a12666d06451a44c4b50))

## [1.15.0](https://github.com/mbehr1/dlt-logs/compare/v1.14.0...v1.15.0) (2021-04-28)


### Features

* add mcnt to restquery results for msgs ([941cd58](https://github.com/mbehr1/dlt-logs/commit/941cd58f0256e8a9b5b87d2767e582ce51d37f4c))

## [1.14.0](https://github.com/mbehr1/dlt-logs/compare/v1.13.0...v1.14.0) (2021-04-09)


### Features

* print lc nr infront of detected lc ([537f467](https://github.com/mbehr1/dlt-logs/commit/537f4676105a9ba816b083f1e04ead52725a8200)), closes [#21](https://github.com/mbehr1/dlt-logs/issues/21)

## [1.13.0](https://github.com/mbehr1/dlt-logs/compare/v1.12.0...v1.13.0) (2021-03-25)


### Features

* **restquery:** filters can request the lifecycle infos as well ([2d443f5](https://github.com/mbehr1/dlt-logs/commit/2d443f5730347ef8e3eee77f7cccb228723646b9))

## [1.12.0](https://github.com/mbehr1/dlt-logs/compare/v1.11.0...v1.12.0) (2021-03-21)


### Features

* **report:** allow multiple selected times ([e438f6a](https://github.com/mbehr1/dlt-logs/commit/e438f6ade9d65b11bb24cbd9b34ead1a188ae14b))

## [1.11.0](https://github.com/mbehr1/dlt-logs/compare/v1.10.6...v1.11.0) (2021-03-20)


### Features

* **report:** show selected time ([1767c7f](https://github.com/mbehr1/dlt-logs/commit/1767c7feb58d77ecf88b605a8f1d53b673d5aaf8))

### [1.10.6](https://github.com/mbehr1/dlt-logs/compare/v1.10.5...v1.10.6) (2021-03-20)


### Bug Fixes

* **report:** use local time format for report tooltip ([0495fb7](https://github.com/mbehr1/dlt-logs/commit/0495fb727f663bf27bf92d278123d1ab461e0bff))

### [1.10.5](https://github.com/mbehr1/dlt-logs/compare/v1.10.4...v1.10.5) (2021-03-14)


### Bug Fixes

* **someip:** first basic parsing of unions ([f605454](https://github.com/mbehr1/dlt-logs/commit/f605454674658f5ba4d63ce1ca08afe036a8b6d9))
* **someip:** silence console warning output ([08e9e45](https://github.com/mbehr1/dlt-logs/commit/08e9e45d978266baeb89203fc1ebd11a8b499446))

### [1.10.4](https://github.com/mbehr1/dlt-logs/compare/v1.10.3...v1.10.4) (2021-03-13)


### Bug Fixes

* **someip:** support bit-length ([a2d097c](https://github.com/mbehr1/dlt-logs/commit/a2d097c1232740a1838e0b1e3724e8c5d83e4369))

### [1.10.3](https://github.com/mbehr1/dlt-logs/compare/v1.10.2...v1.10.3) (2021-03-07)


### Bug Fixes

* **someip:** output curly braces for undefined ([8a3c94d](https://github.com/mbehr1/dlt-logs/commit/8a3c94dcdeee068f6faef077bc141dda23ffcfdd))
* **someip:** parse EVENTS similar as METHODS ([40df13a](https://github.com/mbehr1/dlt-logs/commit/40df13a0642cd7e96ccb0b9fa8c9a7818c5f8d5c))
* array handling ([5168372](https://github.com/mbehr1/dlt-logs/commit/51683726cc110a61dc9b728bfc9ab5e7d23093e8))

### [1.10.2](https://github.com/mbehr1/dlt-logs/compare/v1.10.1...v1.10.2) (2021-03-07)


### Bug Fixes

* **someip:** add array and string parsing ([b45859f](https://github.com/mbehr1/dlt-logs/commit/b45859fb269858a49978a30643597125d0dceb0e))
* **someip:** serialize bigints ([2757712](https://github.com/mbehr1/dlt-logs/commit/2757712ed3487292b0e101bfcf790e9b20b2c384))


### Performance Improvements

* remove one console log output ([d25ea75](https://github.com/mbehr1/dlt-logs/commit/d25ea75fea0c123e255d30847662fc93fdf1f703))

### [1.10.1](https://github.com/mbehr1/dlt-logs/compare/v1.10.0...v1.10.1) (2021-03-06)


### Bug Fixes

* **someip:** disabled some console logs ([f9e38b6](https://github.com/mbehr1/dlt-logs/commit/f9e38b660eb85542e5c62ad7dc0e3e4770cc670d))

## [1.10.0](https://github.com/mbehr1/dlt-logs/compare/v1.9.2...v1.10.0) (2021-03-06)


### Features

* **someip:** add SOME/IP plugin ([191f7ba](https://github.com/mbehr1/dlt-logs/commit/191f7ba27700beeccbd5b51258cb780a079f2297)), closes [#11](https://github.com/mbehr1/dlt-logs/issues/11)

### [1.9.2](https://github.com/mbehr1/dlt-logs/compare/v1.9.1...v1.9.2) (2021-02-06)


### Bug Fixes

* force type category if yLabels exist ([304d21d](https://github.com/mbehr1/dlt-logs/commit/304d21dbaa5818e156c2b25578045fb796b9a489)), closes [#16](https://github.com/mbehr1/dlt-logs/issues/16) [#16](https://github.com/mbehr1/dlt-logs/issues/16)

### [1.9.1](https://github.com/mbehr1/dlt-logs/compare/v1.9.0...v1.9.1) (2021-02-01)

## [1.9.0](https://github.com/mbehr1/dlt-logs/compare/v1.8.1...v1.9.0) (2021-01-31)


### Features

* **report:** allow to set yAxes parameters to reports ([ba2fef4](https://github.com/mbehr1/dlt-logs/commit/ba2fef4e05fb1de827af4190c53198bd6f728d82)), closes [#14](https://github.com/mbehr1/dlt-logs/issues/14)

### [1.8.1](https://github.com/mbehr1/dlt-logs/compare/v1.8.0...v1.8.1) (2021-01-27)


### Bug Fixes

* **config:** update config setting where it currently exists ([d2a31bd](https://github.com/mbehr1/dlt-logs/commit/d2a31bdd314ab01e6d42deeb99d55f5551c8d046)), closes [#13](https://github.com/mbehr1/dlt-logs/issues/13) [#13](https://github.com/mbehr1/dlt-logs/issues/13)

## [1.8.0](https://github.com/mbehr1/dlt-logs/compare/v1.7.0...v1.8.0) (2021-01-17)


### Features

* **restquery:** allow queries with more than 1000 msgs as result ([56872cc](https://github.com/mbehr1/dlt-logs/commit/56872ccffb23954f8fed7d706d4a5827762594a2))


### Bug Fixes

* cases where windows are not reloaded ([6ea6fe5](https://github.com/mbehr1/dlt-logs/commit/6ea6fe54b74eadac1618c6665290fe07267a2646))
* empty page after filter apply ([5593e42](https://github.com/mbehr1/dlt-logs/commit/5593e4251f12d5cfe321a2f80dd9bc7887309247))
* on treeview selection change only if fragment/line avail ([9f5d528](https://github.com/mbehr1/dlt-logs/commit/9f5d5280745f7094ec7a77455a34298ea508ac9c))

## [1.7.0](https://github.com/mbehr1/dlt-logs/compare/v1.6.0...v1.7.0) (2021-01-17)


### Features

* **treeview:** add quick filter for ecu/apid/ctid ([f884fdf](https://github.com/mbehr1/dlt-logs/commit/f884fdff889c71d848aa36022582d77856d42eb3))

## [1.6.0](https://github.com/mbehr1/dlt-logs/compare/v1.5.0...v1.6.0) (2021-01-16)


### Features

* allow to filter for lifecycles ([290a8fb](https://github.com/mbehr1/dlt-logs/commit/290a8fb60aebb1ffa8026dd712adab7d54a82ada))

## [1.5.0](https://github.com/mbehr1/dlt-logs/compare/v1.4.0...v1.5.0) (2021-01-16)


### Features

* **filters:** add disable,enable,zoomIn/out for 'Filters' ([ee8f13f](https://github.com/mbehr1/dlt-logs/commit/ee8f13f771d147b9e90a3431cb39c812b7deebae))

## [1.4.0](https://github.com/mbehr1/dlt-logs/compare/v1.3.4...v1.4.0) (2021-01-16)


### Features

* **loadtimefilterassistant:** offer disabled load time filters ([17149ac](https://github.com/mbehr1/dlt-logs/commit/17149acf57c8c96d2414ff4fe931db1cbd5be494))


### Bug Fixes

* **addeditfilter:** skip config step for loadTime filters ([ce55c1f](https://github.com/mbehr1/dlt-logs/commit/ce55c1f23a43a06831251b78e07e7a11a3086f75))
* **filter:** dont report configs for loadTime filters ([dfcdcdf](https://github.com/mbehr1/dlt-logs/commit/dfcdcdf7f8f74c6cdab4629aa70612d8f26f5561))
* **multistepinput:** fix back if steps have been skipped ([135a569](https://github.com/mbehr1/dlt-logs/commit/135a569857b5843e4fe4b5a8a3bc5b4ac2acec61))

### [1.3.4](https://github.com/mbehr1/dlt-logs/compare/v1.3.3...v1.3.4) (2021-01-10)


### Bug Fixes

* **dltparser:** add sanity check for robustness ([f5e0c89](https://github.com/mbehr1/dlt-logs/commit/f5e0c89cbee8f15fcb8ab351f3fbb26810e1cf09))
* **lifecycledetection:** limit the number of logs ([f993ef4](https://github.com/mbehr1/dlt-logs/commit/f993ef4cab470eab5cd95a4ee5d193b6c3345d7e))

### [1.3.3](https://github.com/mbehr1/dlt-logs/compare/v1.3.2...v1.3.3) (2021-01-08)


### Bug Fixes

* **restquery:** add lifecycle to messages ([67747b5](https://github.com/mbehr1/dlt-logs/commit/67747b577170399b37e8b7c59d68cce2acdc4739))

### [1.3.2](https://github.com/mbehr1/dlt-logs/compare/v1.3.1...v1.3.2) (2021-01-08)


### Bug Fixes

* **defaults:** lower default for maxNumberLogs to 400k ([2a538e0](https://github.com/mbehr1/dlt-logs/commit/2a538e0207b7d370ab9d4ad62fcf8d360c1a8fbf))
* **report:** restQuery ensure that the new report is used ([74c2335](https://github.com/mbehr1/dlt-logs/commit/74c233580d2fb62621b5526f779e3ecbb1cca110))

### [1.3.1](https://github.com/mbehr1/dlt-logs/compare/v1.3.0...v1.3.1) (2021-01-06)


### Bug Fixes

* **restquery:** trigger event once doc is loaded ([1fec313](https://github.com/mbehr1/dlt-logs/commit/1fec313e9e0540241847bbf474eb521879f3347f))

## [1.3.0](https://github.com/mbehr1/dlt-logs/compare/v1.2.5...v1.3.0) (2021-01-06)


### Features

* **restquery:** add onDidChangeActiveRestQueryDoc api ([5ce503b](https://github.com/mbehr1/dlt-logs/commit/5ce503b3ccfcd50be1478817f67e8fd746e15c15))

### [1.2.5](https://github.com/mbehr1/dlt-logs/compare/v1.2.4...v1.2.5) (2021-01-05)


### Bug Fixes

* **restquery:** treat ecu=null as undefined ([ad60877](https://github.com/mbehr1/dlt-logs/commit/ad60877951006ab1e50106796d393ffee98c110a))

### [1.2.4](https://github.com/mbehr1/dlt-logs/compare/v1.2.3...v1.2.4) (2021-01-05)


### Bug Fixes

* **filter:** accept only lifecycles as array ([62d4d53](https://github.com/mbehr1/dlt-logs/commit/62d4d537dae784484e94db9b20ec2c66e783e0fb))

### [1.2.3](https://github.com/mbehr1/dlt-logs/compare/v1.2.2...v1.2.3) (2021-01-04)


### Bug Fixes

* **reports:** use retainContextWhenHidden to not get empty reports after deselect ([da4d344](https://github.com/mbehr1/dlt-logs/commit/da4d34414ff9f263272202e52eb0c405a2b748e3))
* **restquery:** prefer the docs that are visible ([44efe26](https://github.com/mbehr1/dlt-logs/commit/44efe2680a629e843f65f6853c65d8adc134b5f1))

### [1.2.2](https://github.com/mbehr1/dlt-logs/compare/v1.2.1...v1.2.2) (2021-01-04)


### Bug Fixes

* **report:** queued msgs to webview should be in fifo order ([a165838](https://github.com/mbehr1/dlt-logs/commit/a1658385863caaeb86ebe52784e41d4af900d005)), closes [#7](https://github.com/mbehr1/dlt-logs/issues/7) [#7](https://github.com/mbehr1/dlt-logs/issues/7)

### [1.2.1](https://github.com/mbehr1/dlt-logs/compare/v1.2.0...v1.2.1) (2021-01-02)


### Bug Fixes

* **restquery:** uri decode the parameters ([fa6eb84](https://github.com/mbehr1/dlt-logs/commit/fa6eb847b22cd76a428982ceb9937ad12dad9b6a))

## [1.2.0](https://github.com/mbehr1/dlt-logs/compare/v1.1.3...v1.2.0) (2020-12-31)


### Features

* **configuration:** apply configuration changes instantly ([a792b87](https://github.com/mbehr1/dlt-logs/commit/a792b8734c41793c7ea0dd52c3fe4eb489d9c603))


### Bug Fixes

* **build:** tsc access .id from any not Object ([8529ad2](https://github.com/mbehr1/dlt-logs/commit/8529ad237cef764dbdeccd5854deb8cb432cc1ce))
* **dltfilter:** reInitFromConfiguration apply defaults ([01d6c4e](https://github.com/mbehr1/dlt-logs/commit/01d6c4e96c39ae81d6ee084c5b34823051912c06))
* **filter:** dont wait for onFilterDelete ([757e0be](https://github.com/mbehr1/dlt-logs/commit/757e0be9618c84194f065cb4b1bc89c5da6a1a1d))

### [1.1.3](https://github.com/mbehr1/dlt-logs/compare/v1.1.2...v1.1.3) (2020-12-30)


### Bug Fixes

* **treeview:** filters shall use unique id ([41632f2](https://github.com/mbehr1/dlt-logs/commit/41632f22038d58802ade176a888d0eec707d2f42))
* **treeview:** hide non visible documents ([365ecfb](https://github.com/mbehr1/dlt-logs/commit/365ecfb5c2cb3c3d8ee59f63cd892bb777f3d55e))

### [1.1.2](https://github.com/mbehr1/dlt-logs/compare/v1.1.1...v1.1.2) (2020-12-30)


### Bug Fixes

* **hover:** fix broken table in hover ([23d2679](https://github.com/mbehr1/dlt-logs/commit/23d2679f981bd09fd8789b49f0e8cc5b1d7c8698))

### [1.1.1](https://github.com/mbehr1/dlt-logs/compare/v1.1.0...v1.1.1) (2020-12-30)


### Bug Fixes

* **hover:** show hover info only at the begin of each line ([a19b0a5](https://github.com/mbehr1/dlt-logs/commit/a19b0a5a5e9ffb5aae715978e3bf2f04b4eebcb5))

## [1.1.0](https://github.com/mbehr1/dlt-logs/compare/v1.0.1...v1.1.0) (2020-12-29)


### Features

* **rest-query:** add report as command to filters ([941f1b5](https://github.com/mbehr1/dlt-logs/commit/941f1b578a55a79745b88517e753c4521adff582))

### [1.0.1](https://github.com/mbehr1/dlt-logs/compare/v1.0.0...v1.0.1) (2020-12-28)

### [1.0.0]
* promoted to v1.0.0 as part of introducing semantic-release versioning. No functional changes.

### [0.30.3]
- restQuery: /docs: allow for ecu=name name to be "" and match empty string for all ECUs.

### [0.30.2]
- DltFilter add "not" as config option to negate the filter match result. Useful to create "mandatory" filter (negative with "not"). Currently needs to be set within the config itself and not via UI.

### [0.30.1]
- restQuery: change lifecycle (added id as persistentId and label)
- restQuery: add lifecycles attribute to filter

### [0.30.0]
- implemented rest query for other extensions and via test command "dlt-logs test rest query" for
/get/version, /get/docs/<id>/ecus and /get/docs/<id>/filters. 
For filters options to add/patch/delete/enable/disable are available. But currently without directly persisting them.
But take care any addition action that will store the filters (e.g. add/change via UI) will persist them!

### [0.29.3]
- added (yet empty) restQuery api.

### [0.29.2]
- Removed some wrong package dependencies that lead to a big install package.

### [0.29.1]
- Update outdated packages. 

### [0.29.0]
- Added "EVENT_" / event/scatter reports using single dots and not lines in the reports. See issue/feature request #3.

### [0.28.1]
- Updated readme to point to the new [Docs](https://mbehr1.github.io/dlt-logs/) containing more info for reports (currently).

### [0.28.0]
- Added icons for filter in tree view.
- Filters now support the config option "name" to provide an optional name to ease readability.

### [0.27.0]
- added "params" to conversionFunction for report filters. Keys are "msg", "localObj" and "reportObj".

### [0.26.2]
- timeStamp jumps should be > 10 mins not just a few secs.

### [0.26.1]
- Ignoring timeStamp jumps > 10mins for lifecycle detection.
- Print lifecycle start time with date.

### [0.26.0]
- Lifecycle detection now doesn't mix lifecycles where the ECU id is coming from storageheader and msg header. Lifecycles with ECU from storageheader are prepended with a \<SH\_\>.

### [0.25.1]
- For export logs: removed assumption to lifecycle only grow to start/end for updating the description.

### [0.25.0]
- Added reportOptions.conversionFunction to map or calclate more complex values or add constants to the reports.

### [0.24.1]
- Added INT_ to report capture name to convert directly with parseInt. This needs to be used e.g. for hex values.

### [0.24.0]
- Improved lifecycle detection (mergeing overlapping LCs from same ecu)

### [0.23.1]
- Updated dependencies (after github security advisory)

### [0.23.0]
- Added APID/CTID list into lifecycle tree view. (Next version will add filtering directly on those.)

### [0.22.1]
- Allow TYPE_CONTROL messages with noar>=1.

### [0.22.0]
- Export/filter: Add function to filter export by time range: from-to.

### [0.21.0]
- Export/filter: Add function to export only selected lifecycles.
- Export/filter: Write filter settings used as log msgs into the generated log file. Apid: "VsDl", Ctid: "Info".
- Export/filter: Fix command not activating the extension.

### [0.20.0]
- Added export/filter dlt assistant that allows to: merge dlt files and reorder msgs by calculated time.
- Provide more info in msg hover incl. description of APID/CTID (if available)

### [0.19.0]
- Added load time filter assistant that helps removing messages via APID filters at opening of files >512MB.

### [0.18.1]
- More memory optimization (ECU/APID/CTID strings)

### [0.18.0]
- Memory load/usage optimizations.
- Removed binary-parser.
- Format timestamp in secs in hover.

### [0.17.1]
- Hotfix to improve load performance (and running out of memory). Seems caused by newer binary-parser version. Rolled that back to 1.5.0.
- Improved progress output on loading to better readable values.

### [0.17.0]
- added "configs" feature.
- added icons for dlt logs explorer for files, lifecycles, filter, configs, plugins.

### [0.16.1]
- made parser more robust towards wrong (too small) len info in standard header.
- updated dependencies to newer versions.

### [0.16.0]
- add filter..., edit filter and delete filter features.
- enhanced hover text to provide "add filter..." command and tabluar view.

### [0.15.0]
- Show status bar with number of msgs with current filter / all messages and tooltip with more info.

### [0.14.1]
- Added list of SW versions to the detected lifecycles ECU line and as tooltip for the lifecycles.
- Made lifecycle decoration one line smaller. As usually if filters are active otherwise the first line from next one is decorated.

### [0.14.0]
- Added parsing of control response get_sw_version and get_log_info

### [0.13.1]
- Remove trailing zeros from ECU.

### [0.13.0]
- Added basic non-verbose support.

### [0.12.1]
- Delayed checkActiveExtensions a bit.

### [0.12.0]
- Fix lifecycle times not adjusted on "adjust time..."
- Avoid reentrance problem with applyFilter. For now will just ignore it. If you change filters quickly the last one will be ignored/not-visible! Proper fix to come.

### [0.11.0]
- Report-filter are now added by default into the same (last active) view. So you can show multiple filter in same report.
- Added alt/option command to add report-filter into a new report.

### [0.10.0]
- 'Toggle lifecycle start' now considers overlapping lifecycles.
- Added support for "state" reports. Capture name must start with "STATE_". "reportOptions.valueMap" can be added to the filter to map captured values to shown state names.
- Report: click on a data point in a report reveals the traces close to it.
- Report: Add zoom, drag and pan feature.

### [0.9.8]
- Sort the Dlt logs explorer tree view by files on first level and then by lifecycles, filters, plugins.
- Fix the bug of multiple entries of same type in Dlt logs tree view.

### [0.9.7]
- Moved activity view into "Logs" (added new "logo") (so that it will appear with smart-logs in one view-container)

### [0.9.6]
- Add "adjustTime" implementation including a "sync to last received time event".

### [0.9.5]
- Add "toggle lifecycle start" button to reports that allow to remove the first part of the lifecycle that contains no log messages.

### [0.9.4]
- Synchronize messages to the report webview.

### [0.9.3]
- Fixed timeSeriesReport not part of package.

### [0.9.2]
- Added time-series report feature

### [0.9.1]
- Add decoration for lifecycles.
- Smaller fixes regarding decorations in case of skipped msgs.
- Small optimizations for decoration rendering.

### [0.9.0]
- Auto time-sync (sending time events on selection of a line) can be turned on/off now with the sync button in the editor title. Default off.
- If turned off the time can be send manually by selecting the "send selected time" context button.
- Detected time-sync events can be resend by using "alt/option" on the sync button in the editor title.

### [0.8.0]

- First implementation of **time-sync** feature.

### [0.7.2]

- Prepared for new time-sync events from smart-log 1.2.0. Currently ignoring them.

### [0.7.1]

- Add filter for payload.

### [0.7.0]

- Add filter for mstp, logLevelMin, logLevelMax.
- Improved output for control messages.

### [0.6.0]

- Add configurable columns (button: select columns... in the upper right corner of each dlt-log document).

### [0.5.3]

- Selecting a file transfer reveals the log line (close to it).

### [0.5.2]

- Announce time updates only every 500ms.
- Debounce visible range / scrolling with 200ms.

### [0.5.1]

- Fix cleanup handling on close document (plugin remained in the list).

### [0.5.0]

- Add FileTransfer plugin. Shows file transfers inside the DLT explorer view and allows to save the files.

### [0.4.1]

- Add icons for LOG_WARN, LOG_ERROR and enable/disable filter commands.

### [0.4.0]

- Add marker support. Still with hard coded log level markers (if decorationIds warning, error, fatal do exist).
- Fix automatic reload of dlt-logs on editor startup.

### [0.3.1]

- Fixed filters with multiple matches using "and" and not "or". So all criteria have to match.

### [0.3.0]

 - Added filter view with enabling/disabling of non load time filters (non persistent)

### [0.2.0]

- Added basic filter support (no marker support yet)

### [0.1.0]

- Initial release without filter support.
