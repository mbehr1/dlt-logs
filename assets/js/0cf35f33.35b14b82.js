"use strict";(self.webpackChunkdlt_logs=self.webpackChunkdlt_logs||[]).push([[533],{3905:function(e,t,n){n.d(t,{Zo:function(){return d},kt:function(){return c}});var a=n(7294);function r(e,t,n){return t in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}function i(e,t){var n=Object.keys(e);if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e);t&&(a=a.filter((function(t){return Object.getOwnPropertyDescriptor(e,t).enumerable}))),n.push.apply(n,a)}return n}function l(e){for(var t=1;t<arguments.length;t++){var n=null!=arguments[t]?arguments[t]:{};t%2?i(Object(n),!0).forEach((function(t){r(e,t,n[t])})):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(n)):i(Object(n)).forEach((function(t){Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(n,t))}))}return e}function o(e,t){if(null==e)return{};var n,a,r=function(e,t){if(null==e)return{};var n,a,r={},i=Object.keys(e);for(a=0;a<i.length;a++)n=i[a],t.indexOf(n)>=0||(r[n]=e[n]);return r}(e,t);if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e);for(a=0;a<i.length;a++)n=i[a],t.indexOf(n)>=0||Object.prototype.propertyIsEnumerable.call(e,n)&&(r[n]=e[n])}return r}var s=a.createContext({}),u=function(e){var t=a.useContext(s),n=t;return e&&(n="function"==typeof e?e(t):l(l({},t),e)),n},d=function(e){var t=u(e.components);return a.createElement(s.Provider,{value:t},e.children)},p={inlineCode:"code",wrapper:function(e){var t=e.children;return a.createElement(a.Fragment,{},t)}},m=a.forwardRef((function(e,t){var n=e.components,r=e.mdxType,i=e.originalType,s=e.parentName,d=o(e,["components","mdxType","originalType","parentName"]),m=u(n),c=r,f=m["".concat(s,".").concat(c)]||m[c]||p[c]||i;return n?a.createElement(f,l(l({ref:t},d),{},{components:n})):a.createElement(f,l({ref:t},d))}));function c(e,t){var n=arguments,r=t&&t.mdxType;if("string"==typeof e||r){var i=n.length,l=new Array(i);l[0]=m;var o={};for(var s in t)hasOwnProperty.call(t,s)&&(o[s]=t[s]);o.originalType=e,o.mdxType="string"==typeof e?e:r,l[1]=o;for(var u=2;u<i;u++)l[u]=n[u];return a.createElement.apply(null,l)}return a.createElement.apply(null,n)}m.displayName="MDXCreateElement"},5162:function(e,t,n){n.d(t,{Z:function(){return l}});var a=n(7294),r=n(4334),i="tabItem_Ymn6";function l(e){var t=e.children,n=e.hidden,l=e.className;return a.createElement("div",{role:"tabpanel",className:(0,r.Z)(i,l),hidden:n},t)}},5488:function(e,t,n){n.d(t,{Z:function(){return c}});var a=n(3117),r=n(7294),i=n(4334),l=n(2389),o=n(7392),s=n(7094),u=n(2466),d="tabList__CuJ",p="tabItem_LNqP";function m(e){var t,n,l=e.lazy,m=e.block,c=e.defaultValue,f=e.values,g=e.groupId,h=e.className,N=r.Children.map(e.children,(function(e){if((0,r.isValidElement)(e)&&"value"in e.props)return e;throw new Error("Docusaurus error: Bad <Tabs> child <"+("string"==typeof e.type?e.type:e.type.name)+'>: all children of the <Tabs> component should be <TabItem>, and every <TabItem> should have a unique "value" prop.')})),b=null!=f?f:N.map((function(e){var t=e.props;return{value:t.value,label:t.label,attributes:t.attributes}})),k=(0,o.l)(b,(function(e,t){return e.value===t.value}));if(k.length>0)throw new Error('Docusaurus error: Duplicate values "'+k.map((function(e){return e.value})).join(", ")+'" found in <Tabs>. Every value needs to be unique.');var v=null===c?c:null!=(t=null!=c?c:null==(n=N.find((function(e){return e.props.default})))?void 0:n.props.value)?t:N[0].props.value;if(null!==v&&!b.some((function(e){return e.value===v})))throw new Error('Docusaurus error: The <Tabs> has a defaultValue "'+v+'" but none of its children has the corresponding value. Available values are: '+b.map((function(e){return e.value})).join(", ")+". If you intend to show no default tab, use defaultValue={null} instead.");var y=(0,s.U)(),C=y.tabGroupChoices,w=y.setTabGroupChoices,T=(0,r.useState)(v),A=T[0],x=T[1],P=[],O=(0,u.o5)().blockElementScrollPositionUntilNextRender;if(null!=g){var E=C[g];null!=E&&E!==A&&b.some((function(e){return e.value===E}))&&x(E)}var I=function(e){var t=e.currentTarget,n=P.indexOf(t),a=b[n].value;a!==A&&(O(t),x(a),null!=g&&w(g,String(a)))},D=function(e){var t,n=null;switch(e.key){case"ArrowRight":var a,r=P.indexOf(e.currentTarget)+1;n=null!=(a=P[r])?a:P[0];break;case"ArrowLeft":var i,l=P.indexOf(e.currentTarget)-1;n=null!=(i=P[l])?i:P[P.length-1]}null==(t=n)||t.focus()};return r.createElement("div",{className:(0,i.Z)("tabs-container",d)},r.createElement("ul",{role:"tablist","aria-orientation":"horizontal",className:(0,i.Z)("tabs",{"tabs--block":m},h)},b.map((function(e){var t=e.value,n=e.label,l=e.attributes;return r.createElement("li",(0,a.Z)({role:"tab",tabIndex:A===t?0:-1,"aria-selected":A===t,key:t,ref:function(e){return P.push(e)},onKeyDown:D,onFocus:I,onClick:I},l,{className:(0,i.Z)("tabs__item",p,null==l?void 0:l.className,{"tabs__item--active":A===t})}),null!=n?n:t)}))),l?(0,r.cloneElement)(N.filter((function(e){return e.props.value===A}))[0],{className:"margin-top--md"}):r.createElement("div",{className:"margin-top--md"},N.map((function(e,t){return(0,r.cloneElement)(e,{key:t,hidden:e.props.value!==A})}))))}function c(e){var t=(0,l.Z)();return r.createElement(m,(0,a.Z)({key:String(t)},e))}},8157:function(e,t,n){n.r(t),n.d(t,{assets:function(){return m},contentTitle:function(){return d},default:function(){return g},frontMatter:function(){return u},metadata:function(){return p},toc:function(){return c}});var a=n(3117),r=n(102),i=(n(7294),n(3905)),l=n(5488),o=n(5162),s=["components"],u={id:"canPlugin",title:"CAN decoder plugin",sidebar_label:"Plugin CAN decoder"},d=void 0,p={unversionedId:"canPlugin",id:"canPlugin",title:"CAN decoder plugin",description:"DLT-Logs extension version >= 1.50.0 come with a built-in CAN decoder plugin based on configurable fibex files and the possibility to open CAN file in .asc format directly.",source:"@site/docs/canPlugin.md",sourceDirName:".",slug:"/canPlugin",permalink:"/dlt-logs/docs/canPlugin",draft:!1,editUrl:"https://github.com/mbehr1/dlt-logs/edit/master/docs/dlt-logs/docs/canPlugin.md",tags:[],version:"current",frontMatter:{id:"canPlugin",title:"CAN decoder plugin",sidebar_label:"Plugin CAN decoder"},sidebar:"dltLogsSideBar",previous:{title:"Plugin SOME/IP decoder",permalink:"/dlt-logs/docs/someIpPlugin"},next:{title:"Plugin Non-verbose mode",permalink:"/dlt-logs/docs/nonVerbosePlugin"}},m={},c=[{value:"Example",id:"example",level:2},{value:"Explanation",id:"explanation",level:3},{value:"Configuration",id:"configuration",level:2},{value:"Treeview",id:"treeview",level:2},{value:"Encoding of CAN messages in DLT log message",id:"encoding-of-can-messages-in-dlt-log-message",level:2},{value:"Limitations",id:"limitations",level:2}],f={toc:c};function g(e){var t=e.components,n=(0,r.Z)(e,s);return(0,i.kt)("wrapper",(0,a.Z)({},f,n,{components:t,mdxType:"MDXLayout"}),(0,i.kt)("p",null,"DLT-Logs extension version >= 1.50.0 come with a built-in CAN decoder plugin based on configurable fibex files and the possibility to open CAN file in ",(0,i.kt)("inlineCode",{parentName:"p"},".asc")," format directly."),(0,i.kt)("h2",{id:"example"},"Example"),(0,i.kt)("p",null,"If a CAN ",(0,i.kt)("inlineCode",{parentName:"p"},".asc")," file is opened and the CAN plugin is configured with a FIBEX file the CAN messages will be decoded e.g. like this:"),(0,i.kt)("pre",null,(0,i.kt)("code",{parentName:"pre"},'CAN1 CAN TC   can      > IuK_CAN 0x510 Networkmanagement3_Status [<orig can payload>]:{"Networkmanagement3":{"NM3ControlBitVector":..., "NM3SenderECUId":...,...}}\n')),(0,i.kt)("h3",{id:"explanation"},"Explanation"),(0,i.kt)("table",null,(0,i.kt)("thead",{parentName:"table"},(0,i.kt)("tr",{parentName:"thead"},(0,i.kt)("th",{parentName:"tr",align:null},"symbol"),(0,i.kt)("th",{parentName:"tr",align:null},"description"))),(0,i.kt)("tbody",{parentName:"table"},(0,i.kt)("tr",{parentName:"tbody"},(0,i.kt)("td",{parentName:"tr",align:null},(0,i.kt)("inlineCode",{parentName:"td"},"CAN1")),(0,i.kt)("td",{parentName:"tr",align:null},"First CAN bus/channel. CAN channels/buses are mapped to ECU ids with name CANx.")),(0,i.kt)("tr",{parentName:"tbody"},(0,i.kt)("td",{parentName:"tr",align:null},(0,i.kt)("inlineCode",{parentName:"td"},"CAN")),(0,i.kt)("td",{parentName:"tr",align:null},"static APID ",(0,i.kt)("inlineCode",{parentName:"td"},"CAN")," is used for CAN frames,")),(0,i.kt)("tr",{parentName:"tbody"},(0,i.kt)("td",{parentName:"tr",align:null},(0,i.kt)("inlineCode",{parentName:"td"},"TC")),(0,i.kt)("td",{parentName:"tr",align:null},"static CTID ",(0,i.kt)("inlineCode",{parentName:"td"},"TC")," is used for decoded CAN frames")),(0,i.kt)("tr",{parentName:"tbody"},(0,i.kt)("td",{parentName:"tr",align:null},(0,i.kt)("inlineCode",{parentName:"td"},">")),(0,i.kt)("td",{parentName:"tr",align:null},"RX/TX direction. ",(0,i.kt)("inlineCode",{parentName:"td"},">")," for a received msg (RX), ",(0,i.kt)("inlineCode",{parentName:"td"},"<")," for a transmitted frame (TX).")),(0,i.kt)("tr",{parentName:"tbody"},(0,i.kt)("td",{parentName:"tr",align:null},(0,i.kt)("inlineCode",{parentName:"td"},"IuK_CAN")),(0,i.kt)("td",{parentName:"tr",align:null},"Name of the CAN bus. Here ",(0,i.kt)("inlineCode",{parentName:"td"},"IuK_CAN"),".")),(0,i.kt)("tr",{parentName:"tbody"},(0,i.kt)("td",{parentName:"tr",align:null},(0,i.kt)("inlineCode",{parentName:"td"},"0x510")),(0,i.kt)("td",{parentName:"tr",align:null},"CAN frame identifier")),(0,i.kt)("tr",{parentName:"tbody"},(0,i.kt)("td",{parentName:"tr",align:null},(0,i.kt)("inlineCode",{parentName:"td"},"Networkmanagement3_Status")),(0,i.kt)("td",{parentName:"tr",align:null},"Name of the frame identifier.")),(0,i.kt)("tr",{parentName:"tbody"},(0,i.kt)("td",{parentName:"tr",align:null},(0,i.kt)("inlineCode",{parentName:"td"},"{...}")),(0,i.kt)("td",{parentName:"tr",align:null},"Decoded payload of the frame in JSON format")))),(0,i.kt)("h2",{id:"configuration"},"Configuration"),(0,i.kt)("p",null,"You have to configure the CAN plugin. To configure the plugin call"),(0,i.kt)(l.Z,{groupId:"operating-systems",defaultValue:"win",values:[{label:"Windows",value:"win"},{label:"macOS",value:"mac"},{label:"Linux",value:"linux"}],mdxType:"Tabs"},(0,i.kt)(o.Z,{value:"win",mdxType:"TabItem"},'Use F1 or Ctrl+Shift+P and enter/select command "Preferences: Open Settings (JSON)".'),(0,i.kt)(o.Z,{value:"mac",mdxType:"TabItem"},'Use \u21e7\u2318P and enter/select command "Preferences: Open Settings (JSON)".'),(0,i.kt)(o.Z,{value:"linux",mdxType:"TabItem"},'Use Ctrl+Shift+P and enter/select command "Preferences: Open Settings (JSON)".')),(0,i.kt)("pre",null,(0,i.kt)("code",{parentName:"pre",className:"language-jsonc"},'"dlt-logs.plugins": [\n        {\n            "name":"CAN",\n            "enabled": true, // you can set it to false to disable the plugin\n            "fibexDir": "/home/..." // or "c:\\\\...". Set it to the folder containing your FIBEX files.\n        },\n        {\n            "name": "FileTransfer", // config for other plugins, here file transfer plugin...\n            ...\n        },\n    ],\n')),(0,i.kt)("admonition",{type:"note"},(0,i.kt)("p",{parentName:"admonition"},"The ",(0,i.kt)("inlineCode",{parentName:"p"},"fibexDir")," needs to point to a folder containing the FIBEX files with extension .xml.\nPlease keep the files uncompressed (no .zip, no .tgz) there.")),(0,i.kt)("admonition",{type:"note"},(0,i.kt)("p",{parentName:"admonition"},"You can keep multiple files in the folder. If you have multiple files providing info for the same CAN bus/channel the channels are merged by adding missing frame ids to the first fibex providing the channel. So please ensure that all frames from channels with the same short-name and with same a identifier have the same semantics/meaning!")),(0,i.kt)("admonition",{type:"note"},(0,i.kt)("p",{parentName:"admonition"},"If you changed the content of the folder for now you do need to open a new file or use ",(0,i.kt)("inlineCode",{parentName:"p"},"Developer: Reload window")," to reload the window incl. the extension host.")),(0,i.kt)("h2",{id:"treeview"},"Treeview"),(0,i.kt)("p",null,"In the tree-view you'll find more information about the loaded CAN channels and frames, PDUs, signals under"),(0,i.kt)("pre",null,(0,i.kt)("code",{parentName:"pre"},"Plugins\n|- CAN Decoder\n   |- Channels #<number of channels loaded>\n      | - <list of all loaded channels/busses\n          | - <list of all frames for that channel with short name > sorted by frame id\n            | - <list of all PDUs within that frame>\n                | - <list of all signal-instances>\n   | - Signals #<number of signals loaded>\n   | - Codings #<number of (en-)codings for datatypes loaded>\n")),(0,i.kt)("admonition",{type:"note"},(0,i.kt)("p",{parentName:"admonition"},"The tooltip of each item contains more info e.g. the description (if available in the FIBEX).")),(0,i.kt)("p",null,"(todo add picture)"),(0,i.kt)("admonition",{type:"tip"},(0,i.kt)("p",{parentName:"admonition"},"From the tree view frames you can directly apply a filter with the ",(0,i.kt)("inlineCode",{parentName:"p"},"adjust filter to hide details")," (if the frames are currently visible) or ",(0,i.kt)("inlineCode",{parentName:"p"},"adjust filter to show more details")," icon button on the right hand side of the frame item."),(0,i.kt)("p",{parentName:"admonition"},"Using the ",(0,i.kt)("inlineCode",{parentName:"p"},"open report")," icon you can directly open a graphical report showing the frame data over time!\n(todo add picture)")),(0,i.kt)("h2",{id:"encoding-of-can-messages-in-dlt-log-message"},"Encoding of CAN messages in DLT log message"),(0,i.kt)("p",null,"The decoder assumes that the message is encoded as type ",(0,i.kt)("inlineCode",{parentName:"p"},"NW_TRACE/CAN")," with the CTID ",(0,i.kt)("inlineCode",{parentName:"p"},"TC"),". The CAN message itself is encoded as two raw message payloads:"),(0,i.kt)("ol",null,(0,i.kt)("li",{parentName:"ol"},"4 bytes with the frame identifier."),(0,i.kt)("li",{parentName:"ol"},"CAN frame payload")),(0,i.kt)("h2",{id:"limitations"},"Limitations"),(0,i.kt)("ul",null,(0,i.kt)("li",{parentName:"ul"},"Limited testing. Please raise an issue if you find unsupported CAN traces!")))}g.isMDXComponent=!0}}]);