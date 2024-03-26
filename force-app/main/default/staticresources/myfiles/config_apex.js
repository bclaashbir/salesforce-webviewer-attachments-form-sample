var resourceURL = '/resource/'
window.Core.forceBackendType('ems');

var documentViewer = instance.Core.documentViewer;

var urlSearch = new URLSearchParams(location.hash)
var custom = JSON.parse(urlSearch.get('custom'));
var version = ''
resourceURL = resourceURL + custom.namespacePrefix + version;

/**
 * The following `window.Core.set*` functions point WebViewer to the
 * optimized source code specific for the Salesforce platform, to ensure the
 * uploaded files stay under the 5mb limit
 */
// office workers
window.Core.setOfficeWorkerPath(resourceURL + 'office')
window.Core.setOfficeAsmPath(resourceURL + 'office_asm');
window.Core.setOfficeResourcePath(resourceURL + 'office_resource');

//office editing
window.Core.setOfficeEditorWorkerPath(resourceURL + 'office_edit');

// pdf workers
window.Core.setPDFResourcePath(resourceURL + 'resource')
if (custom.fullAPI) {
  window.Core.setPDFWorkerPath(resourceURL + 'pdf_full');
} else {
  window.Core.setPDFWorkerPath(resourceURL + 'pdf_lean')
}

// external 3rd party libraries
window.Core.setExternalPath(resourceURL + 'external')

var currentDocId;

window.addEventListener('documentLoaded', () => {
  console.log('document loaded!');
});

async function saveDocument() {
  // SF document file size limit
  const docLimit = 5 * Math.pow(1024, 2);
  const doc = instance.Core.documentViewer.getDocument();
  if (!doc) {
    return;
  }
  instance.UI.openElement('loadingModal');
  const fileSize = await doc.getFileSize();
  const fileType = doc.getType();
  let filename = doc.getFilename();

  if (fileType == 'image'){
    filename = filename.replace(/\.[^/.]+$/, ".pdf")
  }
  const xfdfString = await instance.Core.documentViewer.getAnnotationManager().exportAnnotations();
  const data = await doc.getFileData({
    // Saves the document with annotations in it
    xfdfString
  });

  let binary = '';
  const bytes = new Uint8Array(data);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  const base64Data = window.btoa(binary);

  const payload = {
    title: filename.replace(/\.[^/.]+$/, ""),
    filename,
    base64Data,
    contentDocumentId: currentDocId
  }
  // Post message to LWC
  fileSize < docLimit ? parent.postMessage({ type: 'SAVE_DOCUMENT', payload }, '*') : downloadWebViewerFile();
}

const downloadWebViewerFile = async () => {
  const doc = instance.Core.documentViewer.getDocument();

  if (!doc) {
    return;
  }

  const data = await doc.getFileData();
  const arr = new Uint8Array(data);
  const blob = new Blob([arr], { type: 'application/pdf' });

  const filename = doc.getFilename();

  downloadFile(blob, filename)
}

const downloadFile = (blob, fileName) => {
  const link = document.createElement('a');
  // create a blobURI pointing to our Blob
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  // some browser needs the anchor to be in the doc
  document.body.append(link);
  link.click();
  link.remove();
  // in case the Blob uses a lot of memory
  setTimeout(() => URL.revokeObjectURL(link.href), 7000);
};

function createSavedModal(instance) {
  const divInput = document.createElement('div');
  divInput.innerText = 'File saved successfully.';
  const modal = {
    dataElement: 'savedModal',
    body: {
      className: 'myCustomModal-body',
      style: {
        'text-align': 'center'
      },
      children: [divInput]
    }
  }
  instance.UI.addCustomModal(modal);
}

instance.UI.addEventListener('viewerLoaded', async function () {
  instance.UI.hotkeys.on('ctrl+s, command+s', e => {
    e.preventDefault();
    saveDocument();
  });

  // Create a button, with a disk icon, to invoke the saveDocument function
  instance.UI.setHeaderItems(function (header) {
    var myCustomButton = {
      type: 'actionButton',
      dataElement: 'saveDocumentButton',
      title: 'tool.SaveDocument',
      img: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/><path d="M17 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm-5 16c-1.66 0-3-1.34-3-3s1.34-3 3-3 3 1.34 3 3-1.34 3-3 3zm3-10H5V5h10v4z"/></svg>',
      onClick: function () {
        saveDocument();
      }
    }
    header.push(myCustomButton);

    //new button to grab data from Salesforce
    var grabSFDataButton = {
      type: 'actionButton',
      dataElement: 'grabDataButton',
      title: 'grab SF data',
      img: 'icon-arrow-down',
      onClick: function () {
        parent.postMessage({ type: 'REQUEST_DATA' }, '*');
      }
    }
    header.push(grabSFDataButton);

    //new button to validate form data
    var validateButton = {
      type: 'actionButton',
      dataElement: 'validateButton',
      title: 'validate data',
      img: 'icon-menu-checkmark',
      onClick: function () {
        //grab the field manager
        const fieldManager = instance.Core.annotationManager.getFieldManager();

        //simple popup if all fields marked as required aren't filled out
        if (!(fieldManager.areRequiredFieldsFilled()))
          alert("Missing a required field!");

        //optionally can create labels for fields as well, just delete last name to try this one, but you can create different messages for different fields based upon why they didn't pass validation
        const lastName = fieldManager.getField("lastNameField");
        if (lastName.flags.get('Required')) //check if it's a required field
        {
          if (!lastName.value) //if empty then we'll make sure the user has an indicator pointing to the field
          {
            lastName.widgets[0].setFieldIndicator(true, "Fill this out!"); //create the label
            instance.Core.annotationManager.trigger('annotationChanged', [lastName.widgets, 'modify', {}]);  //trigger the change to make sure the label shows up
          }
          else //if filled out then make sure we clear any indicator from a previous validation (could also hook into an event on a change to the field value to immediately check/validate and clear the indicator)
            lastName.widgets[0].setFieldIndicator(false); //remove the label
            instance.Core.annotationManager.trigger('annotationChanged', [lastName.widgets, 'modify', {}]);  //trigger the change to make sure the label shows up
        }

        //make sure 2 checkboxes are selected
        var numOfSelectedCheckboxes = 0;
        const checkboxWidgetAnnotations = instance.Core.annotationManager.getAnnotationsList().filter(annotation => annotation instanceof Core.Annotations.CheckButtonWidgetAnnotation)
        checkboxWidgetAnnotations.forEach((checkbox) => {
          if (checkbox.getValue() == "Yes")
          numOfSelectedCheckboxes++;
        })
        if (numOfSelectedCheckboxes < 2)
          alert("Not enough checkboxes selected!");
        else if (numOfSelectedCheckboxes > 2)
          alert("too many checkboxes selected!");

        //we can also embed javascript into the fields themselves and use some standards from the pdf spec
        //first we'll make sure only numbers can be inserted into the amount field, then we'll make the 12x amount field autocalculate
        //grab the widgets
        const amount = fieldManager.getField("amountField").widgets[0];
        const annualAmount = fieldManager.getField("amountX12Field").widgets[0];
        //create the javascript actions we'll be using
        const keystrokeAction = new instance.Core.Actions.JavaScript({javascript: 'AFNumber_Keystroke(0,0,0,0,"",true)'}); //function is built into pdf's, can find a list of these at https://opensource.adobe.com/dc-acrobat-sdk-docs/library/interapp/IAC_API_FormsIntro.html
        const calculateAction = new instance.Core.Actions.JavaScript({javascript: 'this.getField("amountX12Field").value = this.getField("amountField").value * 12'}); //can also insert custom javascript which we'll use to multiply the value of a previous field by 12
        //add the actions to the field widgets, some potential triggers are: 'K' is keystroke, 'C' is calculate, 'V' is validate
        amount.addAction('K', keystrokeAction);
        annualAmount.addAction('C', calculateAction);
        fieldManager.setCalculationOrder(["amountField", "amountX12Field"]); //make sure any change to amountField causes a Calculate event for amountX12Field
        //you can use the below action on a field to play around and see when a validate event would trigger
        //const validateAction = new instance.Core.Actions.JavaScript({javascript: 'alert("validate")'});
        
      }
    }
    header.push(validateButton);

  });

  // When the viewer has loaded, this makes the necessary call to get the
  // pdftronWvInstance code to pass User Record information to this config file
  // to invoke annotManager.setCurrentUser
  instance.Core.documentViewer.getAnnotationManager().setCurrentUser(custom.username);

  createSavedModal(instance);
});

window.addEventListener("message", receiveMessage, false);


fieldData; //place to store the SF field data that is returned

//new function to insert the data we grabbed into the actual pdf form fields
function fillForm (fieldData) {
  const fieldManager = instance.Core.annotationManager.getFieldManager(); //grab the field manager

  /* Generally to grab all the field names from a document I just use the below
  fieldManager.forEachField(field => {
    console.log(field);
  })
  */

  //just a few form fields so I just directly did it below, but probably more normal to use a map or 2d array or some kind of structure to map the data you're inputting into the pdf form field names
  fieldManager.getField("firstNameField").setValue(fieldData.contactFields.FirstName);
  fieldManager.getField("lastNameField").setValue(fieldData.contactFields.LastName);
  fieldManager.getField("emailField").setValue(fieldData.contactFields.Email);
  fieldManager.getField("phoneField").setValue(fieldData.contactFields.Phone);
  fieldManager.getField("amountField").setValue(fieldData.oppFields.Amount);
  fieldManager.getField("amountX12Field").setValue(fieldData.oppFields.Amount * 12);
  fieldManager.getField("Radio Button 38").widgets[1].innerElement.click(); //radio buttons all have the same field name in a PDF, the individual buttons are in an array of widgets starting with '0'
  fieldManager.getField("checkboxField1").widgets[0].innerElement.click();
  fieldManager.getField("checkboxField3").widgets[0].innerElement.click();

};

function receiveMessage(event) {
  if (event.isTrusted && typeof event.data === 'object') {
    switch (event.data.type) {
      case 'OPEN_DOCUMENT':
        instance.loadDocument(event.data.file)
        break;
      case 'OPEN_DOCUMENT_BLOB':
        const { blob, extension, filename, documentId } = event.data.payload;
        console.log("documentId", documentId);
        currentDocId = documentId;
        instance.UI.loadDocument(blob, { extension, filename, documentId })
        break;
      case 'DOCUMENT_SAVED':
        console.log(`${JSON.stringify(event.data)}`);
        instance.UI.openElements(['savedModal']);
        setTimeout(() => {
          instance.UI.closeElements(['savedModal', 'loadingModal'])
        }, 2000)
        break;
      case 'LMS_RECEIVED':  
        instance.loadDocument(event.data.payload.message, {
          filename: event.data.payload.filename,
          withCredentials: false
        });
        break;
      case 'DOWNLOAD_DOCUMENT':
        downloadWebViewerFile();
        break;
      case 'CLOSE_DOCUMENT':
        instance.UI.closeDocument()
        break;
      case 'ADD_FIELD_DATA':
        fieldData = event.data.payload;
        //console.log(fieldData);
        fillForm(fieldData);
        break;
      default:
        break;
    }
  }
}
