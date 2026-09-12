describe('The Home Page', () => {
  it('shows phone-only contact options and no estimate form', () => {
    cy.visit('/')
    cy.get('#estimate-form').should('not.exist')
    cy.contains('Call for a Free Estimate').should('be.visible')
    cy.get('a[href="tel:+17245574429"]').should('be.visible')
    cy.get('a[href="tel:+17244390963"]').should('be.visible')
  })

  it('does not load or call the retired visitor counter', () => {
    let visits = 0
    cy.intercept('POST', '/api/visits', req => {
      visits += 1
      req.reply({ statusCode: 410 })
    })
    cy.visit('/')
    cy.get('script[src="js/runtime-config.js"]').should('not.exist')
    cy.get('script[src="js/site.js"]').should('not.exist')
    cy.wait(250)
    cy.then(() => expect(visits).to.equal(0))
  })
})
