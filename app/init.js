sap.ui.define(['sap/ui/core/mvc/XMLView'], XMLView => {
  'use strict'
  XMLView.create({ viewName: 'desk.Main' }).then(view => view.placeAt('content'))
})
