/* Vision Quest — interactions */
(function(){
  'use strict';
  var doc = document;

  /* ---- sticky nav ---- */
  var nav = doc.querySelector('.nav');
  function onScrollNav(){ if(window.scrollY > 60) nav.classList.add('scrolled'); else nav.classList.remove('scrolled'); }
  onScrollNav();

  /* ---- parallax layers ---- */
  var layers = [].slice.call(doc.querySelectorAll('[data-parallax]'));
  var ticking = false;
  function parallax(){
    var vh = window.innerHeight;
    layers.forEach(function(el){
      var r = el.parentElement.getBoundingClientRect();
      if(r.bottom < -vh || r.top > vh*1.5) return;        // skip offscreen
      var speed = parseFloat(el.getAttribute('data-parallax')) || 0.18;
      var mid = r.top + r.height/2 - vh/2;
      el.style.transform = 'translate3d(0,' + (-mid*speed) + 'px,0)';
    });
  }
  function tick(){ if(!ticking){ ticking = true; requestAnimationFrame(function(){ onScrollNav(); parallax(); revealCheck(); navCtaCheck(); ticking=false; }); } }
  window.addEventListener('scroll', tick, {passive:true});
  window.addEventListener('resize', parallax);
  parallax();

  /* ---- scroll reveal (scroll-driven, robust) ---- */
  var reveals = [].slice.call(doc.querySelectorAll('.reveal'));
  function revealCheck(){
    var h = window.innerHeight;
    for(var i=reveals.length-1; i>=0; i--){
      var el = reveals[i];
      var top = el.getBoundingClientRect().top;
      if(top < h*0.9){ el.classList.add('in'); reveals.splice(i,1); }
    }
  }
  revealCheck();

  /* ---- nav register button: hidden over the hero, appears once you scroll past the hero CTA ---- */
  var navCta = doc.querySelector('.nav__cta');
  var heroCta = doc.querySelector('.hero__cta');
  function navCtaCheck(){
    if(!navCta || !heroCta) return;
    var ctaBottom = heroCta.getBoundingClientRect().bottom + window.scrollY;
    navCta.classList.toggle('show', window.scrollY > ctaBottom - 72);
  }
  navCtaCheck();

  /* ---- RSVP modal ---- */
  var veil = doc.getElementById('rsvp');
  var form = doc.getElementById('rsvpForm');
  var confirm = doc.getElementById('rsvpConfirm');
  var registrationEndpoint = form ? form.getAttribute('data-registration-endpoint') : '';
  var lastRegistrationPayload = null;
  function openRsvp(session){
    if(form){
      form.reset();
      form.style.display='block';
      var submit = form.querySelector('button[type="submit"]');
      if(submit){ submit.disabled=false; submit.textContent='Join waitlist'; submit.removeAttribute('aria-busy'); }
    }
    if(confirm) confirm.style.display='none';
    var resend = doc.getElementById('rsvpResend');
    if(resend){ resend.style.display='none'; resend.disabled=false; resend.textContent='Resend confirmation'; }
    var opts = [].slice.call(doc.querySelectorAll('.sopt'));
    opts.forEach(function(o){ o.classList.remove('on'); o.setAttribute('aria-pressed','false'); });
    if(session){
      opts.forEach(function(o){ if(o.getAttribute('data-name')===session){ o.classList.add('on'); o.setAttribute('aria-pressed','true'); } });
    }
    var note = doc.getElementById('soptNote'); if(note) note.style.display='none';
    clearRsvpError();
    veil.classList.add('open'); doc.body.style.overflow='hidden';
    var f=veil.querySelector('input'); if(f) setTimeout(function(){f.focus();},300);
  }
  function closeRsvp(){ veil.classList.remove('open'); doc.body.style.overflow=''; }
  [].slice.call(doc.querySelectorAll('[data-open-rsvp]')).forEach(function(b){
    b.addEventListener('click', function(){ openRsvp(b.getAttribute('data-session')); });
  });
  [].slice.call(doc.querySelectorAll('[data-close-rsvp]')).forEach(function(b){ b.addEventListener('click', closeRsvp); });
  veil.addEventListener('click', function(e){ if(e.target===veil) closeRsvp(); });
  doc.addEventListener('keydown', function(e){ if(e.key==='Escape' && veil.classList.contains('open')) closeRsvp(); });

  /* session options (multi-select) */
  [].slice.call(doc.querySelectorAll('.sopt')).forEach(function(o){
    o.addEventListener('click', function(){
      o.classList.toggle('on');
      o.setAttribute('aria-pressed', o.classList.contains('on') ? 'true' : 'false');
      var note = doc.getElementById('soptNote');
      if(note && doc.querySelectorAll('.sopt.on').length) note.style.display='none';
    });
  });

  function clearRsvpError(){
    var error = doc.getElementById('rsvpError');
    if(error){ error.textContent=''; error.style.display='none'; }
    var confirmError = doc.getElementById('rsvpConfirmError');
    if(confirmError){ confirmError.textContent=''; confirmError.style.display='none'; }
  }

  function showRsvpError(message){
    var confirmOpen = confirm && confirm.style.display !== 'none';
    var error = doc.getElementById(confirmOpen ? 'rsvpConfirmError' : 'rsvpError');
    if(error){
      error.textContent = message;
      error.style.display='block';
    }
  }

  function setButtonBusy(button, busy, busyText, readyText){
    if(!button) return;
    button.disabled = !!busy;
    button.textContent = busy ? busyText : readyText;
    if(busy) button.setAttribute('aria-busy','true');
    else button.removeAttribute('aria-busy');
  }

  async function postRegistration(payload){
    var response = await fetch(registrationEndpoint, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body:JSON.stringify(payload)
    });
    var result = await response.json().catch(function(){ return {}; });
    if(!response.ok || !result.ok){
      throw new Error(result.error || 'Registration could not be completed.');
    }
    return result;
  }

  function sessionLabel(session){
    if(session === 'Day Quest') return 'July 19 Day Quest';
    if(session === 'Day Quest Waitlist') return 'Next Day Quest Waitlist';
    return session;
  }

  function sessionList(sessions){
    return (sessions || []).map(sessionLabel).join(' + ');
  }

  function showConfirmation(first, result){
    clearRsvpError();
    form.style.display='none';
    confirm.querySelector('.who').textContent = first ? (', ' + first) : '';
    var sessions = sessionList((result && result.sessions) || []);
    var message = "You're registered for " + sessions + ". We've emailed event details to you.";
    var resend = doc.getElementById('rsvpResend');

    if(result && result.status === 'already_registered'){
      message = "You're already registered for " + sessions + ". We'll email any event changes to you. If the confirmation email did not arrive, resend it below.";
      if(resend) resend.style.display='inline-block';
    }else if(result && result.status === 'confirmation_resent'){
      message = "We resent event details for " + sessions + ".";
      if(resend) resend.style.display='none';
    }else if(result && result.status === 'registration_updated'){
      message = "You're now registered for " + sessions + ". We've emailed updated event details to you.";
      if(resend) resend.style.display='none';
    }else if(resend){
      resend.style.display='none';
    }

    var messageEl = doc.getElementById('rsvpConfirmMessage');
    if(messageEl) messageEl.textContent = message;
    confirm.style.display='block';
  }

  if(form){
    form.addEventListener('submit', async function(e){
      e.preventDefault();
      clearRsvpError();
      var chosen = [].slice.call(doc.querySelectorAll('.sopt.on')).map(function(o){ return o.getAttribute('data-name'); });
      if(chosen.length === 0){
        var note = doc.getElementById('soptNote'); if(note) note.style.display='block';
        return;
      }
      if(!registrationEndpoint){
        showRsvpError('Registration is not ready yet. Please try again in a moment.');
        return;
      }

      var first = ((form.querySelector('#rsvpFirst')||{}).value || '').trim();
      var last = ((form.querySelector('#rsvpLast')||{}).value || '').trim();
      var email = ((form.querySelector('#rsvpEmail')||{}).value || '').trim();
      var website = ((form.querySelector('#rsvpWebsite')||{}).value || '').trim();
      var submit = form.querySelector('button[type="submit"]');
      lastRegistrationPayload = {
        firstName:first,
        lastName:last,
        email:email,
        sessions:chosen,
        website:website
      };
      setButtonBusy(submit, true, 'Sending...', 'Join waitlist');

      try{
        var result = await postRegistration(lastRegistrationPayload);
        showConfirmation(first, result);
      }catch(err){
        showRsvpError((err && err.message) ? err.message : 'Registration could not be completed. Please try again.');
      }finally{
        setButtonBusy(submit, false, 'Sending...', 'Join waitlist');
      }
    });

    var resendButton = doc.getElementById('rsvpResend');
    if(resendButton){
      resendButton.addEventListener('click', async function(){
        if(!lastRegistrationPayload || !registrationEndpoint) return;
        clearRsvpError();
        setButtonBusy(resendButton, true, 'Resending...', 'Resend confirmation');
        try{
          var result = await postRegistration(Object.assign({}, lastRegistrationPayload, { resend:true }));
          showConfirmation(lastRegistrationPayload.firstName, result);
        }catch(err){
          showRsvpError((err && err.message) ? err.message : 'Confirmation could not be resent. Please try again.');
        }finally{
          setButtonBusy(resendButton, false, 'Resending...', 'Resend confirmation');
        }
      });
    }
  }
})();
