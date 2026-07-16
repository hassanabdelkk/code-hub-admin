/* Shared inline application form handler + success modal. */
(function(){
  function fmtWa(num){var d=String(num||'').replace(/[^0-9]/g,'');if(!d)return '';return d.length>4?'+'+d.slice(0,2)+' '+d.slice(2,5)+' '+d.slice(5):'+'+d;}
  function spamHintBox(emailStatus){
    var s=document.createElement('div');
    var failed=emailStatus&&emailStatus.status==='failed';
    var skipped=emailStatus&&emailStatus.status==='skipped';
    s.style.cssText='margin:14px 0 18px;padding:14px 16px;background:'+(failed?'#fee2e2':skipped?'#f1f5f9':'#fef3c7')+';border-left:4px solid '+(failed?'#ef4444':skipped?'#94a3b8':'#f59e0b')+';border-radius:8px;color:'+(failed?'#7f1d1d':skipped?'#334155':'#78350f')+';font-size:13.5px;line-height:1.55;text-align:left;';
    s.innerHTML=failed
      ? 'Ihre Bewerbung ist eingegangen. Die Bestätigungs-E-Mail konnte gerade nicht automatisch versendet werden – nutzen Sie bitte den angezeigten Button oder wir melden uns direkt bei Ihnen.'
      : skipped
        ? 'Ihre Bewerbung ist eingegangen. Falls Sie sich bereits beworben haben, verwenden wir Ihre bestehende Anfrage weiter.'
        : '💡 <strong>Wichtig:</strong> Falls Sie eine E-Mail erwarten, prüfen Sie bitte auch Ihren <strong>Spam-Ordner</strong> und markieren Sie uns als „Kein Spam".';
    return s;
  }
  function showModal(opts){
    opts=opts||{};var isFast=!!opts.fast;var broker=opts.broker||null;var wa=String(opts.whatsapp||'').replace(/[^0-9]/g,'');
    var redirectUrl=opts.redirectUrl||'';var emailStatus=opts.emailStatus||null;
    var isBooking = !isFast && !broker && redirectUrl && /\/buchen\//.test(redirectUrl);
    var ov=document.createElement('div');ov.setAttribute('role','dialog');ov.setAttribute('aria-modal','true');
    ov.style.cssText='position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;backdrop-filter:blur(2px);';
    var box=document.createElement('div');
    box.style.cssText='background:#fff;color:#0f172a;max-width:520px;width:100%;border-radius:14px;padding:32px 28px;box-shadow:0 20px 60px -10px rgba(0,0,0,.35);font-family:inherit;position:relative;text-align:center;';
    var cls=document.createElement('button');cls.type='button';cls.innerHTML='&times;';cls.setAttribute('aria-label','Schließen');
    cls.style.cssText='position:absolute;top:10px;right:14px;background:none;border:0;font-size:24px;line-height:1;cursor:pointer;color:#64748b;';
    cls.onclick=function(){ov.remove();};
    var chk=document.createElement('div');chk.style.cssText='width:64px;height:64px;border-radius:50%;background:#22c55e;display:flex;align-items:center;justify-content:center;margin:0 auto 18px;';
    chk.innerHTML='<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    var h=document.createElement('h3');h.style.cssText='margin:0 0 10px;font-size:24px;font-weight:700;line-height:1.25;';
    var p=document.createElement('p');p.style.cssText='margin:0 0 16px;color:#475569;font-size:15px;line-height:1.55;';
    box.appendChild(cls);box.appendChild(chk);box.appendChild(h);box.appendChild(p);

    if(isBooking){
      // Eigenes Buchungssystem: großer CTA direkt zur Terminwahl.
      h.textContent='✅ Bewerbung eingegangen';
      p.innerHTML='Jetzt fehlt nur noch <strong>Ihr Wunschtermin</strong> für das kurze Erstgespräch.';
      var cta=document.createElement('a');cta.href=redirectUrl;
      cta.textContent='Jetzt Termin auswählen  →';
      cta.style.cssText='display:block;width:100%;background:#0f172a;color:#fff;text-decoration:none;font-weight:600;padding:16px 24px;border-radius:10px;font-size:16px;margin-bottom:6px;box-sizing:border-box;';
      box.appendChild(cta);
      var sub=document.createElement('p');sub.style.cssText='margin:8px 0 4px;font-size:13px;color:#64748b;';sub.textContent=emailStatus&&emailStatus.status==='sent'?'Sie erhalten zusätzlich eine E-Mail als Backup.':'Falls keine E-Mail ankommt, können Sie den Termin direkt über diesen Button buchen.';
      box.appendChild(sub);
      box.appendChild(spamHintBox(emailStatus));
    } else if(broker){
      h.textContent=broker.intro_headline||'✅ Bewerbung eingegangen';
      p.innerHTML=(broker.intro_subline)||(emailStatus&&emailStatus.status==='sent'?'Sie erhalten zusätzlich eine E-Mail mit Ihrem persönlichen Termin-Link.':'Ihr persönlicher Termin-Link ist direkt hier verfügbar.');
      var pc=document.createElement('div');pc.style.cssText='background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;margin:0 0 18px;';
      if(broker.partner_logo){var lg=document.createElement('img');lg.src=broker.partner_logo;lg.alt=broker.partner_name||'';lg.style.cssText='max-height:36px;margin:0 auto 10px;display:block;';pc.appendChild(lg);}
      var pl=document.createElement('div');pl.textContent='Wir verbinden Sie mit';pl.style.cssText='font-size:13px;color:#475569;margin-bottom:6px;';
      var pn=document.createElement('div');pn.textContent=broker.partner_name||'';pn.style.cssText='font-size:17px;font-weight:700;color:#0f172a;';
      pc.appendChild(pl);pc.appendChild(pn);box.appendChild(pc);
      if(broker.calendly_url){var cta2=document.createElement('a');cta2.href=broker.calendly_url;cta2.target='_blank';cta2.rel='noopener';cta2.textContent=(broker.button_label||'Jetzt Termin auswählen')+'  →';
        cta2.style.cssText='display:inline-block;background:#22c55e;color:#fff;text-decoration:none;font-weight:600;padding:14px 28px;border-radius:999px;font-size:16px;';box.appendChild(cta2);}
      box.appendChild(spamHintBox(emailStatus));
    } else if(isFast){
      h.textContent='✅ Bewerbung eingegangen';
      p.textContent='Im nächsten Schritt werden Sie zum Mitarbeiter-Portal weitergeleitet, um Ihre Registrierung abzuschließen.';
      if(redirectUrl){var gn=document.createElement('button');gn.type='button';gn.textContent='Jetzt zum Portal →';
        gn.style.cssText='display:block;width:100%;background:#0f172a;color:#fff;border:0;padding:14px 18px;border-radius:8px;cursor:pointer;font-size:15px;font-weight:600;margin-bottom:12px;';
        var ri=document.createElement('p');ri.style.cssText='margin:0 0 12px;font-size:13px;color:#64748b;';var sec=10;ri.textContent='Automatische Weiterleitung in '+sec+' Sekunden …';
        box.appendChild(gn);box.appendChild(ri);var go=function(){window.location.href=redirectUrl;};gn.onclick=go;
        var t=setInterval(function(){sec-=1;if(sec<=0){clearInterval(t);go();return;}ri.textContent='Automatische Weiterleitung in '+sec+' Sekunden …';},1000);}
      box.appendChild(spamHintBox(emailStatus));
    } else {
      h.textContent='✅ Bewerbung eingegangen';
      p.innerHTML='Ihre Bewerbung wurde gespeichert. Wir melden uns zeitnah per E-Mail oder Telefon bei Ihnen.';
      if(wa){
        var c=document.createElement('div');c.style.cssText='background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:16px;text-align:left;';
        c.innerHTML='<div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#2563eb;margin-bottom:8px;">SCHNELLER KONTAKT</div><p style="margin:0 0 12px;font-size:14px;color:#475569;line-height:1.5;">Melden Sie sich bei WhatsApp unter <strong>'+fmtWa(wa)+'</strong>, um auf dem neusten Stand zu bleiben.</p><a href="https://wa.me/'+wa+'?text='+encodeURIComponent('Hallo, ich habe gerade meine Bewerbung abgeschickt.')+'" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;background:#22c55e;color:#fff;text-decoration:none;font-weight:600;padding:12px 16px;border-radius:8px;font-size:15px;">WhatsApp-Chat starten</a>';
        box.appendChild(c);
      }
    }
    var cb=document.createElement('button');cb.type='button';cb.textContent='Schließen';
    cb.style.cssText='background:#fff;border:1px solid #cbd5e1;color:#0f172a;padding:9px 18px;border-radius:8px;cursor:pointer;font-size:14px;font-weight:500;margin-top:6px;';
    cb.onclick=function(){ov.remove();};box.appendChild(cb);ov.appendChild(box);
    ov.addEventListener('click',function(e){if(e.target===ov)ov.remove();});document.body.appendChild(ov);
  }
  document.addEventListener('DOMContentLoaded',function(){
    var form=document.getElementById('application-form');var status=document.getElementById('form-status');if(!form)return;
    form.addEventListener('submit',function(e){
      e.preventDefault();status.className='lv-form-status';status.textContent='Wird gesendet…';
      var raw=Object.fromEntries(new FormData(form).entries());
      var first=(raw.first_name||'').toString().trim();var last=(raw.last_name||'').toString().trim();var street=(raw.street||'').toString().trim();
      var data={first_name:first||null,last_name:last||null,full_name:(first+' '+last).trim(),email:raw.email,phone:raw.phone||null,
        postal_code:raw.postal_code||null,city:raw.city||null,message:street?'Adresse: '+street:null};
      data.domain=(window.location&&window.location.hostname?window.location.hostname:'').replace(/^www\./,'');
      data.flow_type=window.FLOW_TYPE||'classic';
      if(window.TENANT_ID)data.tenant_id=window.TENANT_ID;
      if(window.PORTAL_URL)data.portal_url=window.PORTAL_URL;
      if(window.SOURCE_SLUG)data.source_slug=window.SOURCE_SLUG;
      fetch(window.PORTAL_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
        .then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json();})
        .then(function(res){form.reset();status.className='lv-form-status success';status.textContent='Bewerbung erfolgreich gesendet.';
          showModal({fast:(window.FLOW_TYPE||'classic')==='fast',whatsapp:window.WHATSAPP_NUMBER||'',redirectUrl:(res&&res.redirect_url)||'',broker:(res&&res.broker)||null,emailStatus:(res&&res.email_status)||null});})
        .catch(function(){status.className='lv-form-status error';status.textContent='Da ist etwas schiefgelaufen. Bitte später erneut versuchen.';});
    });
  });
})();
