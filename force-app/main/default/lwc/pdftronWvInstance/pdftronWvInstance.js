import { LightningElement, wire, track, api } from "lwc";
import { CurrentPageReference } from "lightning/navigation";
import { loadScript } from "lightning/platformResourceLoader";
import libUrl from "@salesforce/resourceUrl/lib";
import myfilesUrl from "@salesforce/resourceUrl/myfiles";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import mimeTypes from "./mimeTypes";
import { fireEvent, registerListener, unregisterAllListeners } from "c/pubsub";
import saveDocument from "@salesforce/apex/PDFTron_ContentVersionController.saveDocument";
import getUser from "@salesforce/apex/PDFTron_ContentVersionController.getUser";
import { getRecord} from 'lightning/uiRecordApi';
//import the newly added function to show how to grab data from a differant salesforce object/record
import getContactInfo from "@salesforce/apex/PDFTron_ContentVersionController.getContactInfo";


const FIELDS = ['Opportunity.Amount']; //fields from the current record we're looking to grab data from


function _base64ToArrayBuffer(base64) {
  var binary_string = window.atob(base64);
  var len = binary_string.length;
  var bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

export default class PdftronWvInstance extends LightningElement {
  //initialization options
  fullAPI = true;
  enableRedaction = true;
  enableFilePicker = true;

  uiInitialized = false;

  source = "My file";
  @api recordId;


  @wire(CurrentPageReference)
  pageRef;

  username;

  recordObject; //place to store the values we're grabbing from the current record
  recordContactObject; //place to store values from the contact object related to the opp object we're using webviewer on

  connectedCallback() {
    registerListener("blobSelected", this.handleBlobSelected, this);
    registerListener("closeDocument", this.closeDocument, this);
    registerListener("downloadDocument", this.downloadDocument, this);
    window.addEventListener("message", this.handleReceiveMessage);
  }

  disconnectedCallback() {
    unregisterAllListeners(this);
    window.removeEventListener("message", this.handleReceiveMessage);
  }

  //grab data from the current record
  wireResult;
  @wire(getRecord, {recordId: "$recordId", fields: FIELDS})
  wiredRecord({error, data}){
    if(error){
      this.dispatchEvent(
        new ShowToastEvent({
            title: 'Error loading contact',
            message: 'ERROR',
            variant: 'error',
        }),
    );
    this.wireResult = error;
    } else if (data){
      const payload = {
        dat: data
      };
      this.recordObject = {};
      for (const property in data.fields){
        this.recordObject[property] = data.fields[property].value;
      }
        this.wireResult = data;
    }
  }

  handleBlobSelected(record) {
    const blobby = new Blob([_base64ToArrayBuffer(record.body)], {
      type: mimeTypes[record.FileExtension]
    });

    const payload = {
      blob: blobby,
      extension: record.cv.FileExtension,
      filename: record.cv.Title + "." + record.cv.FileExtension,
      documentId: record.cv.Id
    };
    console.log("payload", payload);
    this.iframeWindow.postMessage({ type: "OPEN_DOCUMENT_BLOB", payload }, "*");
  }

  renderedCallback() {
    var self = this;

    if (this.uiInitialized) {
      return;
    }

    Promise.all([loadScript(self, libUrl + "/webviewer.min.js")])
      .then(() => this.handleInitWithCurrentUser())
      .catch(console.error);
  }

  handleInitWithCurrentUser() {
    getUser()
      .then((result) => {
        this.username = result;
        this.error = undefined;

        this.initUI();
      })
      .catch((error) => {
        console.error(error);
        this.showNotification("Error", error.body.message, "error");
      });
  }

  initUI() {
    var myObj = {
      libUrl: libUrl,
      fullAPI: this.fullAPI || false,
      namespacePrefix: "",
      username: this.username
    };
    var url = myfilesUrl + "/webviewer-demo-annotated.pdf";

    const viewerElement = this.template.querySelector("div");
    // eslint-disable-next-line no-unused-vars
    const viewer = new WebViewer(
      {
        path: libUrl, // path to the PDFTron 'lib' folder on your server
        custom: JSON.stringify(myObj),
        backendType: "ems",
        config: myfilesUrl + "/config_apex.js",
        fullAPI: this.fullAPI,
        enableFilePicker: this.enableFilePicker,
        enableRedaction: this.enableRedaction,
        enableMeasurement: this.enableMeasurement,
        enableOptimizedWorkers: true,
        loadAsPDF: true,
        // enableOfficeEditing: true
         l: 'demo:1708454193493:7f5b428c0300000000a1868abcb527f0551c1d0c68d95233ed06167648'
      },
      viewerElement
    );

    viewerElement.addEventListener("ready", () => {
      this.iframeWindow = viewerElement.querySelector("iframe").contentWindow;
    });
  }

  handleReceiveMessage = (event) => {
    const me = this;
    if (event.isTrusted && typeof event.data === "object") {
      switch (event.data.type) {
        case "SAVE_DOCUMENT":
          let cvId = event.data.payload.contentDocumentId;
          saveDocument({
            json: JSON.stringify(event.data.payload),
            recordId: this.recordId ? this.recordId : "",
            cvId: cvId
          })
            .then((response) => {
              me.iframeWindow.postMessage(
                { type: "DOCUMENT_SAVED", response },
                "*"
              );
              fireEvent(this.pageRef, "refreshOnSave", response);
            })
            .catch((error) => {
              me.iframeWindow.postMessage(
                { type: "DOCUMENT_SAVED", error },
                "*"
              );
              fireEvent(this.pageRef, "refreshOnSave", error);
              console.error(event.data.payload.contentDocumentId);
              console.error(JSON.stringify(error));
              this.showNotification("Error", error.body, "error");
            });
          break;
        case "REQUEST_DATA":
          //grab data from the associated contact object
          getContactInfo({recordId: this.recordId})
            .then((response) => {
              let payload = {
                oppFields: this.recordObject, //pass the previously grabbed data from this record
                contactFields: response //pass the newly grabbed data from the associated contact record
              };

              this.iframeWindow.postMessage({ type: "ADD_FIELD_DATA", payload }, window.origin);
            })
            .catch((error) => {
              me.iframeWindow.postMessage(
                { type: "CONTACT_INFO_ERROR", error },
                "*"
              );
              console.error(event.data.payload);
              console.error(JSON.stringify(error));
              this.showNotification("Error", error.body, "error");
            });
          break;
        default:
          break;
      }
    }
  };

  downloadDocument() {
    this.iframeWindow.postMessage({ type: "DOWNLOAD_DOCUMENT" }, "*");
  }

  @api
  closeDocument() {
    this.iframeWindow.postMessage({ type: "CLOSE_DOCUMENT" }, "*");
  }
}
